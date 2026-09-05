import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Alert } from '../components/ui/Feedback';
import { PageHeader, Panel } from '../components/ui/Panel';

interface PlaceholderPageProps {
  title: string;
  description: string;
  /** What this screen will do once its slice lands. */
  plannedBehaviour: string[];
  /** Where the behaviour is specified, so the next reader can find it. */
  specifiedIn: string[];
}

/**
 * Honest placeholder for a route whose slice is not built yet.
 *
 * States plainly that the module is absent and points at the specification,
 * rather than rendering a convincing but non-functional screen. A feature that
 * only renders UI is explicitly not done (docs/AGENT_INSTRUCTIONS.md 12).
 */
export function PlaceholderPage({
  title,
  description,
  plannedBehaviour,
  specifiedIn,
}: PlaceholderPageProps): ReactNode {
  return (
    <>
      <PageHeader title={title} description={description} />

      <Panel>
        <Alert tone="info" title="Not implemented yet">
          This module has no backend behind it yet, so there is nothing real to show. It is listed
          here to keep the shape of the product visible.
        </Alert>

        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="label-micro">Planned behaviour</h3>
            <ul className="mt-2 space-y-1.5 text-[13px] text-slate-700">
              {plannedBehaviour.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="label-micro">Specified in</h3>
            <ul className="mt-2 space-y-1.5">
              {specifiedIn.map((doc) => (
                <li key={doc}>
                  <code className="font-mono text-[12px] text-slate-600">{doc}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>
    </>
  );
}

export function NotFoundPage(): ReactNode {
  const location = useLocation();

  return (
    <>
      <PageHeader title="Page not found" />
      <Panel>
        <Alert tone="warning">
          <p>
            Nothing is routed at <code className="font-mono text-[12px]">{location.pathname}</code>.
          </p>
          <p className="mt-2">
            <Link to="/overview" className="font-medium underline underline-offset-2">
              Return to the overview
            </Link>
          </p>
        </Alert>
      </Panel>
    </>
  );
}
