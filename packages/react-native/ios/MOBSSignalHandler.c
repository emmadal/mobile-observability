#include "MOBSSignalHandler.h"

#include <errno.h>
#include <fcntl.h>
#include <mach/mach.h>
#include <pthread.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>
#include <sys/ucontext.h>
#include <time.h>
#include <unistd.h>

// Everything reachable from mobs_handle_signal must be async-signal-safe:
// no malloc, no locks, no Objective-C/Swift. All buffers are static.

#define MOBS_PATH_CAPACITY 1024
#define MOBS_CONTEXT_CAPACITY (16 * 1024)
#define MOBS_MAX_FRAMES 100
#define MOBS_ALT_STACK_SIZE (64 * 1024)

static const int kFatalSignals[] = {SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGSEGV, SIGSYS, SIGTRAP};
enum { kFatalSignalCount = sizeof(kFatalSignals) / sizeof(kFatalSignals[0]) };

static struct sigaction g_previous_actions[kFatalSignalCount];
static char g_path[MOBS_PATH_CAPACITY];
static char g_context[2][MOBS_CONTEXT_CAPACITY];
static size_t g_context_length[2];
static _Atomic int g_active_context = -1;
static atomic_bool g_crash_recorded = false;
static atomic_flag g_handling = ATOMIC_FLAG_INIT;
static pthread_mutex_t g_context_mutex = PTHREAD_MUTEX_INITIALIZER;
static bool g_installed = false;
static uint8_t g_alternate_stack[MOBS_ALT_STACK_SIZE];

#pragma mark - Async-signal-safe writers

static void write_bytes(int fd, const char *bytes, size_t length) {
  while (length > 0) {
    ssize_t written = write(fd, bytes, length);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) return;
    bytes += written;
    length -= (size_t)written;
  }
}

static void write_cstring(int fd, const char *text) { write_bytes(fd, text, strlen(text)); }

static void write_unsigned(int fd, uint64_t value) {
  char buffer[21];
  int index = sizeof(buffer);
  do {
    buffer[--index] = (char)('0' + (value % 10));
    value /= 10;
  } while (value != 0 && index > 0);
  write_bytes(fd, buffer + index, sizeof(buffer) - (size_t)index);
}

static void write_signed(int fd, int64_t value) {
  if (value < 0) {
    write_cstring(fd, "-");
    write_unsigned(fd, (uint64_t)(-(value + 1)) + 1);
  } else {
    write_unsigned(fd, (uint64_t)value);
  }
}

static void write_hex(int fd, uint64_t value) {
  static const char digits[] = "0123456789abcdef";
  char buffer[18];
  int index = sizeof(buffer);
  do {
    buffer[--index] = digits[value & 0xF];
    value >>= 4;
  } while (value != 0 && index > 2);
  buffer[--index] = 'x';
  buffer[--index] = '0';
  write_bytes(fd, buffer + index, sizeof(buffer) - (size_t)index);
}

static const char *signal_name(int signal) {
  switch (signal) {
    case SIGABRT: return "SIGABRT";
    case SIGBUS: return "SIGBUS";
    case SIGFPE: return "SIGFPE";
    case SIGILL: return "SIGILL";
    case SIGSEGV: return "SIGSEGV";
    case SIGSYS: return "SIGSYS";
    case SIGTRAP: return "SIGTRAP";
    default: return "SIGNAL";
  }
}

#pragma mark - Stack capture

static bool read_memory(uintptr_t address, void *destination, size_t size) {
  vm_size_t copied = 0;
  kern_return_t result = vm_read_overwrite(mach_task_self(), (vm_address_t)address, size,
                                           (vm_address_t)destination, &copied);
  return result == KERN_SUCCESS && copied == size;
}

static uintptr_t strip_pointer_authentication(uintptr_t pointer) {
#if defined(__arm64__)
  return pointer & 0x0000000FFFFFFFFFULL;
#else
  return pointer;
#endif
}

/// Walks the frame-pointer chain of the crashed thread. Memory is read with
/// vm_read_overwrite so a corrupted stack cannot fault inside the handler.
static int capture_frames(const ucontext_t *context, uintptr_t *frames, int capacity) {
  if (context == NULL || context->uc_mcontext == NULL) return 0;
  int count = 0;
  uintptr_t frame_pointer = 0;
  uintptr_t link_register = 0;
#if defined(__arm64__)
  frames[count++] =
      strip_pointer_authentication((uintptr_t)__darwin_arm_thread_state64_get_pc(context->uc_mcontext->__ss));
  link_register =
      strip_pointer_authentication((uintptr_t)__darwin_arm_thread_state64_get_lr(context->uc_mcontext->__ss));
  if (link_register != 0) frames[count++] = link_register;
  frame_pointer = (uintptr_t)__darwin_arm_thread_state64_get_fp(context->uc_mcontext->__ss);
#elif defined(__x86_64__)
  frames[count++] = (uintptr_t)context->uc_mcontext->__ss.__rip;
  frame_pointer = (uintptr_t)context->uc_mcontext->__ss.__rbp;
#endif
  bool first = true;
  while (count < capacity && frame_pointer != 0 && (frame_pointer & 0x7) == 0) {
    uintptr_t record[2];
    if (!read_memory(frame_pointer, record, sizeof(record))) break;
    uintptr_t return_address = strip_pointer_authentication(record[1]);
    if (return_address == 0) break;
    // In a non-leaf function the saved return address equals the link register.
    if (!(first && return_address == link_register)) frames[count++] = return_address;
    first = false;
    if (record[0] <= frame_pointer) break;
    frame_pointer = record[0];
  }
  return count;
}

#pragma mark - Handler

static void write_crash_record(int signal, const siginfo_t *info, const ucontext_t *context) {
  uintptr_t frames[MOBS_MAX_FRAMES];
  int frame_count = capture_frames(context, frames, MOBS_MAX_FRAMES);

  int fd = open(g_path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) return;

  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  uint64_t timestamp_ms = (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;

  write_cstring(fd, "{\"kind\":\"signal\",\"signal\":\"");
  write_cstring(fd, signal_name(signal));
  write_cstring(fd, "\",\"signalNumber\":");
  write_signed(fd, signal);
  write_cstring(fd, ",\"code\":");
  write_signed(fd, info != NULL ? info->si_code : 0);
  write_cstring(fd, ",\"faultAddress\":\"");
  write_hex(fd, info != NULL ? (uint64_t)(uintptr_t)info->si_addr : 0);
  write_cstring(fd, "\",\"timestamp\":");
  write_unsigned(fd, timestamp_ms);
  write_cstring(fd, ",\"frames\":[");
  for (int i = 0; i < frame_count; i++) {
    if (i > 0) write_cstring(fd, ",");
    write_cstring(fd, "\"");
    write_hex(fd, frames[i]);
    write_cstring(fd, "\"");
  }
  write_cstring(fd, "],\"context\":");
  int active = atomic_load(&g_active_context);
  if (active >= 0 && g_context_length[active] > 0) {
    write_bytes(fd, g_context[active], g_context_length[active]);
  } else {
    write_cstring(fd, "null");
  }
  // A record without this closing brace fails to parse and is discarded on next launch.
  write_cstring(fd, "}");
  close(fd);
}

static void forward_to_previous_handler(int signal) {
  for (int i = 0; i < kFatalSignalCount; i++) {
    if (kFatalSignals[i] == signal) {
      sigaction(signal, &g_previous_actions[i], NULL);
      break;
    }
  }
  // The signal is blocked while this handler runs; it is delivered to the
  // restored handler (or the default action) as soon as we return.
  raise(signal);
}

static void mobs_handle_signal(int signal, siginfo_t *info, void *context) {
  if (!atomic_flag_test_and_set(&g_handling)) {
    if (!atomic_load(&g_crash_recorded)) {
      write_crash_record(signal, info, (const ucontext_t *)context);
    }
    atomic_store(&g_crash_recorded, true);
  }
  forward_to_previous_handler(signal);
}

#pragma mark - Public API

void mobs_install_signal_handlers(const char *path) {
  if (g_installed || path == NULL) return;
  strncpy(g_path, path, sizeof(g_path) - 1);

  stack_t alternate_stack;
  memset(&alternate_stack, 0, sizeof(alternate_stack));
  alternate_stack.ss_sp = g_alternate_stack;
  alternate_stack.ss_size = sizeof(g_alternate_stack);
  sigaltstack(&alternate_stack, NULL);

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_sigaction = mobs_handle_signal;
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  sigemptyset(&action.sa_mask);
  for (int i = 0; i < kFatalSignalCount; i++) {
    sigaction(kFatalSignals[i], &action, &g_previous_actions[i]);
  }
  g_installed = true;
}

void mobs_set_crash_context(const char *json, size_t length) {
  if (json == NULL || length >= MOBS_CONTEXT_CAPACITY) return;
  pthread_mutex_lock(&g_context_mutex);
  int next = atomic_load(&g_active_context) == 0 ? 1 : 0;
  memcpy(g_context[next], json, length);
  g_context_length[next] = length;
  atomic_store(&g_active_context, next);
  pthread_mutex_unlock(&g_context_mutex);
}

void mobs_mark_crash_recorded(void) { atomic_store(&g_crash_recorded, true); }

void mobs_trigger_crash(int signal) {
  if (signal == SIGSEGV) {
    volatile int *invalid = (volatile int *)(uintptr_t)0x10;
    *invalid = 1;
  }
  raise(signal);
}
