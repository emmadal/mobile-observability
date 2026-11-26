'use client';

import { useFormStatus } from 'react-dom';
import { signOut } from '@/app/actions/auth';
import { SignOutIcon } from '@/components/icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/**
 * Sidebar sign-out: asks for confirmation first, then runs the signOut Server
 * Action through a plain form so the redirect to /login stays server-driven.
 */
export function SignOutButton() {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-raised hover:text-ink"
        title="Sign out"
      >
        <SignOutIcon />
        <span className="sr-only">Sign out</span>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>
            You will need to sign in again to open the dashboard.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <form action={signOut} className="contents">
            <ConfirmButton />
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <AlertDialogAction type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </AlertDialogAction>
  );
}
