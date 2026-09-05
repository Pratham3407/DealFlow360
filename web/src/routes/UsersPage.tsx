import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiList } from '../lib/api';
import { ROLE_LABELS, type Role, type UserSummary } from '../lib/types';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/Feedback';
import { PageHeader, Panel } from '../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../components/ui/Table';

const ROLE_TONES: Record<Role, BadgeTone> = {
  ADMIN: 'accent',
  SALES_REP: 'neutral',
  SALES_MANAGER: 'neutral',
  FINANCE_OPERATIONS: 'neutral',
  CUSTOMER: 'warning',
};

function formatDateTime(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * User administration.
 *
 * Reads GET /api/users, which is gated on the users:manage capability. It is the
 * one fully wired internal screen in this slice, which makes it the end-to-end
 * proof that cookie session, RBAC and typed client all line up.
 */
export function UsersPage(): ReactNode {
  const [showInactive, setShowInactive] = useState(true);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiList<UserSummary>('/users?limit=200'),
    retry: false,
  });

  const users = data?.data ?? [];

  const rows = useMemo(
    () => users.filter((user) => showInactive || user.active),
    [users, showInactive],
  );

  const inactiveCount = users.filter((user) => !user.active).length;

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts are provisioned by an administrator. Deactivating an account revokes its sessions immediately."
        actions={
          <Button size="sm" loading={isFetching && !isLoading} onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />

      <Panel
        title={data ? `${data.meta.total} account${data.meta.total === 1 ? '' : 's'}` : 'Accounts'}
        description={
          inactiveCount > 0 ? `${inactiveCount} deactivated` : 'All accounts are active'
        }
        actions={
          inactiveCount > 0 ? (
            <label className="flex items-center gap-2 text-[13px] text-slate-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
                className="size-3.5 rounded border-slate-300"
              />
              Show deactivated
            </label>
          ) : null
        }
        flush
      >
        {isLoading ? (
          <LoadingState label="Loading accounts" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No accounts to show"
            description={
              showInactive
                ? 'Seed the database or create the first account to get started.'
                : 'Every account is currently deactivated.'
            }
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Customer</Th>
                <Th>Last sign-in</Th>
                <Th align="right">Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((user) => (
                <Tr key={user.id}>
                  <Td className="font-medium text-slate-900">{user.name}</Td>
                  <Td>
                    <span className="font-mono text-[12px]">{user.email}</span>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                  </Td>
                  <Td>{user.customerName ?? <span className="text-slate-400">internal</span>}</Td>
                  <Td className="tabular whitespace-nowrap text-slate-600">
                    {formatDateTime(user.lastLoginAt)}
                  </Td>
                  <Td align="right">
                    <Badge tone={user.active ? 'positive' : 'critical'}>
                      {user.active ? 'active' : 'deactivated'}
                    </Badge>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
