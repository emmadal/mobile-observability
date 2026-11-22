#ifndef MOBSSignalHandler_h
#define MOBSSignalHandler_h

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Installs handlers for fatal signals. When one fires, a JSON crash record is
/// written to `path` using only async-signal-safe calls, then the previous
/// handler (or the default action) runs. Call once, as early as possible.
void mobs_install_signal_handlers(const char *path);

/// Replaces the JSON context embedded in crash records. Called from one thread
/// at a time (the JS thread); the signal handler reads it without locking.
void mobs_set_crash_context(const char *json, size_t length);

/// Marks that this process already wrote a crash record (for example for an
/// uncaught NSException), so the SIGABRT that follows is not reported twice.
void mobs_mark_crash_recorded(void);

/// Test helper: raises `signal` in the calling thread.
void mobs_trigger_crash(int signal);

#ifdef __cplusplus
}
#endif

#endif /* MOBSSignalHandler_h */
