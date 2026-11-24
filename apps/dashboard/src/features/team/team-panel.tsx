import { HealthBadge, Panel } from '@/components/ui';
import type { OrgContext } from '@/features/projects/access';
import { CopyField } from '@/features/projects/copy-field';
import { invitationPath } from '@/lib/request-origin';
import { listMembers, listPendingInvitations } from './service';
import { InviteForm, RemoveMemberButton, RevokeInvitationButton } from './team-forms';

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

/** People with access to the workspace, and the invites still open. */
export async function TeamPanel({ context, origin }: { context: OrgContext; origin: string }) {
  const isOwner = context.role === 'owner';
  const [members, invitations] = await Promise.all([
    listMembers(context.organizationId),
    isOwner ? listPendingInvitations(context.organizationId) : Promise.resolve([]),
  ]);

  return (
    <Panel
      id="team"
      title="People"
      description={
        isOwner
          ? 'Only you can invite people, create projects and rotate keys.'
          : 'The workspace owner manages who has access.'
      }
      className="scroll-mt-6"
    >
      <div className="mt-4 border-t border-line">
        {isOwner && <InviteForm />}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <caption className="sr-only">Members</caption>
            <thead className="border-b border-line text-ink-3">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Role
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Joined
                </th>
                {isOwner && (
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((person) => (
                <tr key={person.memberId} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink">
                      {person.name}
                      {person.userId === context.userId && (
                        <span className="text-ink-3"> (you)</span>
                      )}
                    </p>
                    <p className="text-2xs text-ink-3">{person.email}</p>
                  </td>
                  <td className="px-3 py-3 text-ink-2">
                    {person.role === 'owner' ? 'Owner' : 'Member'}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink-3 tabular">
                    {dateFormat.format(person.joinedAt)}
                  </td>
                  {isOwner && (
                    <td className="px-5 py-3 text-right">
                      {person.role !== 'owner' && (
                        <RemoveMemberButton memberId={person.memberId} name={person.name} />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isOwner && invitations.length > 0 && (
          <div className="border-t border-line">
            <h3 className="px-5 pt-4 text-xs font-semibold text-ink">Pending invites</h3>
            <ul className="mt-2">
              {invitations.map((invite) => {
                const expired = invite.expired;
                return (
                  <li
                    key={invite.id}
                    className="grid gap-3 border-t border-line px-5 py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
                  >
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{invite.email}</span>
                        {expired ? (
                          <HealthBadge health="warning" label="Expired" />
                        ) : (
                          <span className="text-2xs text-ink-3">
                            Expires {dateFormat.format(invite.expiresAt)}
                          </span>
                        )}
                      </div>
                      {!expired && (
                        <CopyField
                          label="Invite link"
                          value={`${origin}${invitationPath(invite.id)}`}
                        />
                      )}
                    </div>
                    <RevokeInvitationButton invitationId={invite.id} email={invite.email} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
