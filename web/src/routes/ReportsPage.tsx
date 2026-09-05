import { useMemo, useState, type ReactNode } from "react";
import { Download, FileText, Search } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { PageHeader, Panel } from "../components/ui/Panel";

const reps = [
  {
    initials: "AR",
    name: "Arjun Reddy",
    segment: "Enterprise & Strategic",
    attainment: 91.8,
    deals: 38,
    revenue: "₹18.6M",
    discount: 8.2,
    status: "On track",
    risk: "A+",
  },
  {
    initials: "MK",
    name: "Meera Kapoor",
    segment: "Mid-Market & Growth",
    attainment: 86.4,
    deals: 31,
    revenue: "₹14.2M",
    discount: 9.1,
    status: "On track",
    risk: "A",
  },
  {
    initials: "RN",
    name: "Rahul Nair",
    segment: "SMB & Digital",
    attainment: 79.7,
    deals: 27,
    revenue: "₹11.4M",
    discount: 10.8,
    status: "1 review",
    risk: "B+",
  },
  {
    initials: "PV",
    name: "Priya Verma",
    segment: "Public Sector & BFSI",
    attainment: 75.1,
    deals: 24,
    revenue: "₹10.2M",
    discount: 11.6,
    status: "1 escalation",
    risk: "B",
  },
  {
    initials: "SS",
    name: "Siddharth Sen",
    segment: "Public Sector & BFSI",
    attainment: 72.3,
    deals: 29,
    revenue: "₹9.8M",
    discount: 12.5,
    status: "2 escalations",
    risk: "D",
  },
];
const months = [
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
];
const actuals = [42, 58, 47, 72, 64, 83, 69, 91, 77, 88, 74, 96];

function Kpi({
  label,
  value,
  change,
  note,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  note: string;
  icon: string;
}): ReactNode {
  return (
    <article className="rounded-lg border border-hairline bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] text-slate-500">{label}</span>
        <span className="grid size-7 place-items-center rounded-md bg-brand-50 text-brand-700">
          {icon}
        </span>
      </div>
      <strong className="mt-3 block text-2xl tracking-tight text-slate-950">
        {value}
      </strong>
      <div className="mt-2 flex items-center gap-2">
        <Badge
          tone={label === "Annual recurring (ARR)" ? "accent" : "positive"}
        >
          {change}
        </Badge>
        <span className="text-[11px] text-slate-500">{note}</span>
      </div>
    </article>
  );
}

function RevenueChart(): ReactNode {
  return (
    <div className="mt-5 flex h-52 gap-3">
      <div className="flex flex-col justify-between pb-7 text-[10px] text-slate-400">
        <span>₹70M</span>
        <span>₹50M</span>
        <span>₹30M</span>
        <span>₹10M</span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="absolute inset-x-0 top-0 flex h-[calc(100%-28px)] flex-col justify-between">
          {[1, 2, 3, 4].map((line) => (
            <div
              key={line}
              className="border-t border-dashed border-slate-200"
            />
          ))}
        </div>
        <div className="relative flex h-full items-end justify-around gap-1">
          {actuals.map((height, index) => (
            <div
              key={months[index]}
              className="relative flex h-full flex-1 items-end justify-center"
            >
              <span
                className="absolute bottom-7 w-3 rounded-t bg-slate-200"
                style={{ height: `${Math.min(100, height + 8)}%` }}
              />
              <span
                className="absolute bottom-7 w-3 rounded-t bg-brand-600 transition-all hover:bg-brand-800"
                style={{ height: `${height}%` }}
                title={`${months[index]} actual`}
              />
              <small className="absolute bottom-0 text-[9px] text-slate-400">
                {months[index]}
              </small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReportsPage(): ReactNode {
  const [team, setTeam] = useState("All regional teams");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredReps = useMemo(
    () =>
      reps.filter((rep) =>
        rep.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <>
      <PageHeader
        title="Executive Sales Ops & Commercial Reports"
        description="Quarterly performance analytics, discount discipline, cycle times, and recurring revenue expansion."
        actions={
          <div className="flex flex-wrap gap-2">
            <select
              value={team}
              onChange={(event) => setTeam(event.target.value)}
              className="h-9 rounded-md border border-hairline bg-surface px-3 text-xs text-slate-700 outline-none"
            >
              <option>All regional teams</option>
              <option>North America</option>
              <option>EMEA</option>
              <option>APAC</option>
            </select>
            <Button
              size="sm"
              variant="secondary"
              icon={<FileText className="size-3.5" />}
            >
              Export PDF
            </Button>
            <Button size="sm" icon={<Download className="size-3.5" />}>
              Download XLSX
            </Button>
          </div>
        }
      />
      <div className="mt-2 flex items-center gap-2 border-b border-hairline pb-4 text-xs text-slate-500">
        <span className="rounded border border-hairline bg-slate-50 px-2 py-1 font-medium text-slate-700">
          Q3 FY25
        </span>
        <span>Preview dataset</span>
        <span className="ml-auto flex items-center gap-1 text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Reporting service connected
        </span>
      </div>
      <section
        aria-label="Executive KPI overview"
        className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <Kpi
          label="Gross bookings"
          value="₹58.4M"
          change="+18.2%"
          note="vs quarterly target"
          icon="₹"
        />
        <Kpi
          label="Blended gross margin"
          value="24.6%"
          change="+2.6% buffer"
          note="Target: 22.0%"
          icon="◒"
        />
        <Kpi
          label="Average discount rate"
          value="9.4%"
          change="-1.8% QoQ"
          note="discipline gain"
          icon="%"
        />
        <Kpi
          label="Annual recurring (ARR)"
          value="₹14.8M"
          change="+32% YoY"
          note="expansion"
          icon="↻"
        />
        <Kpi
          label="Quote-to-cash cycle"
          value="14.2 days"
          change="4.1d faster"
          note="vs FY24 baseline"
          icon="◷"
        />
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Panel
          title="Revenue realization & forecast"
          description="Gross bookings versus quarterly target across FY25"
          actions={
            <div className="flex gap-3 text-[11px] text-slate-500">
              <span>
                <i className="mr-1 inline-block size-2 rounded-full bg-brand-600" />
                Actual
              </span>
              <span>
                <i className="mr-1 inline-block size-2 rounded-full bg-slate-300" />
                Target
              </span>
            </div>
          }
        >
          <RevenueChart />
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-hairline pt-3 text-[11px] text-slate-500">
            <div>
              Q3 actual
              <strong className="mt-1 block text-sm text-slate-900">
                ₹58.4M
              </strong>
            </div>
            <div>
              Target attainment
              <strong className="mt-1 block text-sm text-brand-700">
                112.4%
              </strong>
            </div>
            <div>
              Forecast close
              <strong className="mt-1 block text-sm text-slate-900">
                ₹64.2M
              </strong>
            </div>
          </div>
        </Panel>
        <Panel
          title="Commercial health"
          description="Current quarter signal summary"
        >
          <div className="flex items-center gap-4 py-4">
            <div className="grid size-20 place-items-center rounded-full border-[8px] border-slate-200 border-t-brand-600">
              <strong className="text-xl">84</strong>
            </div>
            <div>
              <strong className="text-lg text-slate-900">Healthy</strong>
              <p className="text-xs text-slate-500">Portfolio health score</p>
              <Badge tone="positive">↗ 6.2 pts QoQ</Badge>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Pipeline coverage</span>
                <strong className="text-slate-900">3.8x</strong>
              </div>
              <div className="mt-2 h-1.5 rounded bg-slate-100">
                <div className="h-full w-3/4 rounded bg-brand-600" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Renewal confidence</span>
                <strong className="text-slate-900">91.4%</strong>
              </div>
              <div className="mt-2 h-1.5 rounded bg-slate-100">
                <div className="h-full w-[91%] rounded bg-emerald-500" />
              </div>
            </div>
          </div>
          <button className="mt-5 text-xs font-semibold text-brand-700 hover:underline">
            View deal health report →
          </button>
        </Panel>
      </section>
      +{" "}
      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Panel
          title="Discount governance & margin realization"
          description="Product line discount sensitivity mapped against actual margin capture"
        >
          <div className="divide-y divide-hairline">
            {[
              [
                "Software subscriptions",
                "8.5%",
                "68.0%",
                "High leverage",
                "68",
              ],
              [
                "Hardware infrastructure",
                "11.2%",
                "26.4%",
                "Healthy margin",
                "26",
              ],
              [
                "Professional services",
                "14.1%",
                "18.2%",
                "Compression watch",
                "18",
              ],
            ].map(([name, discount, margin, tag, width]) => (
              <div key={name} className="py-4 first:pt-1 last:pb-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <strong>{name}</strong>
                  <Badge
                    tone={tag === "Compression watch" ? "warning" : "positive"}
                  >
                    {tag}
                  </Badge>
                  <span className="ml-auto text-slate-500">
                    Discount <b className="text-slate-800">{discount}</b> ·
                    Margin <b className="text-brand-700">{margin}</b>
                  </span>
                </div>
                <div className="mt-3 flex h-3 overflow-hidden rounded border border-hairline bg-slate-100">
                  <span
                    className="bg-brand-600"
                    style={{ width: `${width}%` }}
                  />
                  <span className="bg-amber-400" style={{ width: discount }} />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>0%</span>
                  <span>Target discount cap: 10.0%</span>
                  <span>Margin realized: ₹24.2M</span>
                  <span>100%</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Executive alerts"
          description="Items requiring leadership attention"
          actions={<Badge tone="critical">4</Badge>}
        >
          <div className="divide-y divide-hairline">
            {[
              [
                "Discount compression detected",
                "Professional Services exceeded cap by 2.1%",
                "critical",
              ],
              ["3 renewals at risk", "₹4.2M ARR due within 30 days", "warning"],
              [
                "Strong regional momentum",
                "APAC is 18% above quarterly target",
                "accent",
              ],
            ].map(([title, detail, tone]) => (
              <div key={title} className="flex gap-3 py-3">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded ${tone === "critical" ? "bg-red-50 text-red-600" : tone === "warning" ? "bg-amber-50 text-amber-600" : "bg-brand-50 text-brand-700"}`}
                >
                  !
                </span>
                <div>
                  <strong className="text-xs">{title}</strong>
                  <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
                  <small className="text-[10px] text-slate-400">
                    18 min ago
                  </small>
                </div>
              </div>
            ))}
          </div>
          <button className="mt-3 text-xs font-semibold text-brand-700 hover:underline">
            View all alerts →
          </button>
        </Panel>
      </section>
      +{" "}
      <Panel
        title="Commercial rep performance"
        description="Quota attainment, bookings, and discount discipline by rep"
        className="mt-5"
        actions={
          <div className="relative">
            <Search className="absolute left-2.5 top-2 size-3.5 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search reps"
              className="h-8 w-36 rounded border border-hairline pl-8 pr-2 text-xs outline-none focus:border-brand-600"
            />
          </div>
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-right text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">Commercial rep</th>
                <th className="px-4 py-3">Quota attainment</th>
                <th className="px-4 py-3">Won deals</th>
                <th className="px-4 py-3">Won revenue</th>
                <th className="px-4 py-3">Avg. discount</th>
                <th className="px-4 py-3">Approvals</th>
                <th className="px-4 py-3">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredReps.map((rep) => (
                <tr key={rep.name} className="border-t border-hairline">
                  <td className="px-4 py-3 text-left">
                    <div className="flex items-center gap-2">
                      <span className="grid size-7 place-items-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">
                        {rep.initials}
                      </span>
                      <span>
                        <strong className="block text-xs text-slate-900">
                          {rep.name}
                        </strong>
                        <small className="text-[10px] text-slate-400">
                          {rep.segment}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <span className="h-1.5 w-14 overflow-hidden rounded bg-slate-100">
                        <span
                          className="block h-full rounded bg-brand-600"
                          style={{ width: `${rep.attainment}%` }}
                        />
                      </span>
                      <b className="text-brand-700">{rep.attainment}%</b>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{rep.deals}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {rep.revenue}
                  </td>
                  <td
                    className={`px-4 py-3 ${rep.discount > 12 ? "text-red-600" : "text-slate-600"}`}
                  >
                    {rep.discount}%
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        rep.status.includes("escalation")
                          ? "critical"
                          : rep.status.includes("review")
                            ? "warning"
                            : "positive"
                      }
                    >
                      {rep.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        rep.risk === "D"
                          ? "critical"
                          : rep.risk === "B"
                            ? "warning"
                            : "positive"
                      }
                    >
                      {rep.risk} risk
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-hairline px-4 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Showing <b>{filteredReps.length}</b> of <b>28</b> commercial reps{" "}
            <span className="mx-2 text-slate-300">|</span> Quota cohort: FY25 Q3
            Regular
          </span>
          <div className="flex">
            <button
              disabled={page === 1}
              onClick={() => setPage(Math.max(1, page - 1))}
              className="rounded-l border border-hairline px-2 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button className="border-y border-brand-600 bg-brand-600 px-2 py-1 text-white">
              {page}
            </button>
            <button
              onClick={() => setPage(Math.min(3, page + 1))}
              className="border border-hairline px-2 py-1"
            >
              Next
            </button>
          </div>
        </div>
      </Panel>
      +{" "}
      <div className="mt-5 flex flex-col justify-between gap-2 border-t border-hairline pt-3 text-[10px] text-slate-400 sm:flex-row">
        <span>
          <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
          Data pipeline: live synced from ERP & CPQ Core 12 minutes ago
        </span>
        <span>
          Confidential · Internal CFO & Sales Ops Committee Distribution Only ·
          DealFlow360 v4.8 Enterprise
        </span>
      </div>
      +{" "}
    </>
  );
}
