import { useMemo, useState } from "react";
import "./App.css";

const navItems = [
  ["▦", "Dashboard"],
  ["▤", "Quotations"],
  ["▥", "Pipeline"],
  ["✓", "Approvals"],
  ["♧", "Customers"],
  ["▣", "Products"],
  ["↗", "Fulfillment"],
  ["▥", "Billing"],
  ["♡", "Deal Health"],
  ["◈", "Reports"],
];
const reps = [
  [
    "AR",
    "Arjun Reddy",
    "Enterprise & Strategic",
    "91.8%",
    "38",
    "₹18.6M",
    "8.2%",
    "On Track",
    "A+",
  ],
  [
    "MK",
    "Meera Kapoor",
    "Mid-Market & Growth",
    "86.4%",
    "31",
    "₹14.2M",
    "9.1%",
    "On Track",
    "A",
  ],
  [
    "RN",
    "Rahul Nair",
    "SMB & Digital",
    "79.7%",
    "27",
    "₹11.4M",
    "10.8%",
    "1 Review",
    "B+",
  ],
  [
    "PV",
    "Priya Verma",
    "Public Sector & BFSI",
    "75.1%",
    "24",
    "₹10.2M",
    "11.6%",
    "1 Escalation",
    "B",
  ],
  [
    "SS",
    "Siddharth Sen",
    "Public Sector & BFSI",
    "72.3%",
    "29",
    "₹9.8M",
    "12.5%",
    "2 Escalations",
    "D",
  ],
];
const chartBars = [42, 58, 47, 72, 64, 83, 69, 91, 77, 88, 74, 96];

function App() {
  const [active, setActive] = useState("Reports");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [team, setTeam] = useState("All Regional Teams");
  const filteredReps = useMemo(
    () => reps.filter((rep) => rep[1].toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <div className="brand-mark">◈</div>
            <div>
              <strong>DealFlow360</strong>
              <small>Enterprise Sales Ops</small>
            </div>
          </div>
          <button className="primary-action">
            ＋ <span>New Quotation</span>
          </button>
          <nav>
            {navItems.map(([icon, label]) => (
              <button
                key={label}
                className={active === label ? "nav-item active" : "nav-item"}
                onClick={() => setActive(label)}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="configuration">
          <small>CONFIGURATION</small>
          <button className="nav-item">
            <span>%</span>Discount Rules
          </button>
          <button className="nav-item">
            <span>⌂</span>Warehouses
          </button>
          <button className="nav-item">
            <span>♙</span>Users
          </button>
          <button className="nav-item">
            <span>◉</span>User Settings
          </button>
        </div>
      </aside>
      <div className="content-wrap">
        <header className="topbar">
          <div className="search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search reports, deals, SKU..."
            />
          </div>
          <div className="top-links">
            <button>Dashboard</button>
            <button>Quotations</button>
            <button>Approvals</button>
            <button className="selected">Reports</button>
          </div>
          <div className="profile-actions">
            <button title="Notifications">♧</button>
            <button title="Help">?</button>
            <i></i>
            <div className="avatar">VP</div>
            <div className="profile-name">
              <strong>Vikram Rao</strong>
              <small>VP Sales Ops & CFO</small>
            </div>
            <span>⌄</span>
          </div>
        </header>
        <main>
          <section className="page-heading">
            <div>
              <div className="heading-line">
                <h1>Executive Sales Ops & Commercial Reports</h1>
                <span className="period">Q3 FY25</span>
              </div>
              <p>
                Quarterly performance analytics, discount discipline, cycle times, and
                recurring revenue expansion.
              </p>
            </div>
            <div className="toolbar">
              <button>▣ Q3 FY2025 - Jul to Sep⌄</button>
              <select value={team} onChange={(event) => setTeam(event.target.value)}>
                <option>All Regional Teams</option>
                <option>North America</option>
                <option>EMEA</option>
                <option>APAC</option>
              </select>
              <button className="currency">INR ₹⌄</button>
              <button>⇩ Export PDF</button>
              <button className="download">▤ Download XLSX</button>
            </div>
          </section>
          <section className="kpi-grid">
            {[
              ["Gross Bookings", "₹58.4M", "+18.2%", "vs quarterly target", "↗"],
              ["Blended Gross Margin", "24.6%", "+2.6% buffer", "Target: 22.0%", "◒"],
              ["Average Discount Rate", "9.4%", "-1.8% QoQ", "discipline gain", "⌁"],
              ["Annual Recurring (ARR)", "₹14.8M", "+32% YoY", "expansion", "↻"],
              [
                "Quote-to-Cash Cycle",
                "14.2 Days",
                "4.1d faster",
                "vs FY24 baseline",
                "◷",
              ],
            ].map(([title, value, delta, note, icon]) => (
              <article className="kpi" key={title}>
                <div className="kpi-top">
                  <span>{title}</span>
                  <b>{icon}</b>
                </div>
                <strong>{value}</strong>
                <div>
                  <em className={title === "Annual Recurring (ARR)" ? "purple" : "good"}>
                    {delta}
                  </em>
                  <small>{note}</small>
                </div>
              </article>
            ))}
          </section>
          <section className="dashboard-grid">
            <article className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <h2>Revenue Realization & Forecast</h2>
                  <p>Gross bookings versus quarterly target across FY25</p>
                </div>
                <div className="legend">
                  <span>
                    <i className="blue-dot"></i>Actual
                  </span>
                  <span>
                    <i className="gray-dot"></i>Target
                  </span>
                </div>
              </div>
              <div className="chart">
                <div className="y-axis">
                  <span>₹70M</span>
                  <span>₹50M</span>
                  <span>₹30M</span>
                  <span>₹10M</span>
                </div>
                <div className="chart-area">
                  <div className="grid-lines">
                    <i></i>
                    <i></i>
                    <i></i>
                    <i></i>
                  </div>
                  <div className="bars">
                    {chartBars.map((height, index) => (
                      <div className="bar-group" key={index}>
                        <span
                          className="target-bar"
                          style={{ height: `${Math.min(100, height + 7)}%` }}
                        ></span>
                        <span
                          className="actual-bar"
                          style={{ height: `${height}%` }}
                        ></span>
                        <small>
                          {
                            [
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
                            ][index]
                          }
                        </small>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chart-summary">
                <span>
                  Q3 actual <strong>₹58.4M</strong>
                </span>
                <span>
                  Target attainment <strong className="text-blue">112.4%</strong>
                </span>
                <span>
                  Forecast close <strong>₹64.2M</strong>
                </span>
              </div>
            </article>
            <article className="panel health-panel">
              <div className="panel-heading">
                <div>
                  <h2>Commercial Health</h2>
                  <p>Current quarter signal summary</p>
                </div>
                <button className="dots">•••</button>
              </div>
              <div className="health-row">
                <div className="ring">
                  <strong>84</strong>
                  <small>/100</small>
                </div>
                <div>
                  <strong>Healthy</strong>
                  <p>Portfolio health score</p>
                  <em className="good">↗ 6.2 pts QoQ</em>
                </div>
              </div>
              <div className="signal">
                <span>Pipeline coverage</span>
                <strong>
                  3.8x <small>of target</small>
                </strong>
                <div className="progress">
                  <i style={{ width: "76%" }}></i>
                </div>
              </div>
              <div className="signal">
                <span>Renewal confidence</span>
                <strong>91.4%</strong>
                <div className="progress green">
                  <i style={{ width: "91%" }}></i>
                </div>
              </div>
              <button className="text-button">View deal health report →</button>
            </article>
          </section>
          <section className="dashboard-grid lower">
            <article className="panel discount-panel">
              <div className="panel-heading">
                <div>
                  <h2>Discount Governance & Margin Realization</h2>
                  <p>
                    Product line discount sensitivity mapped against actual margin capture
                  </p>
                </div>
                <button className="dots">•••</button>
              </div>
              {[
                ["Software Subscriptions", "8.5%", "68.0%", "High Leverage", "68"],
                ["Hardware Infrastructure", "11.2%", "26.4%", "Healthy Margin", "26"],
                ["Professional Services", "14.1%", "18.2%", "Compression Watch", "18"],
              ].map(([name, discount, margin, tag, width]) => (
                <div className="discount-row" key={name}>
                  <div className="discount-title">
                    <strong>{name}</strong>
                    <span className={tag === "Compression Watch" ? "tag warning" : "tag"}>
                      {tag}
                    </span>
                    <small>
                      Discount <b>{discount}</b> &nbsp; Margin <b>{margin}</b>
                    </small>
                  </div>
                  <div className="stacked">
                    <i style={{ width: `${width}%` }}></i>
                    <em style={{ width: discount }}></em>
                  </div>
                  <div className="row-foot">
                    <span>0%</span>
                    <span>Target discount cap: 10.0%</span>
                    <span>Margin realized: ₹24.2M</span>
                    <span>100%</span>
                  </div>
                </div>
              ))}
            </article>
            <article className="panel alert-panel">
              <div className="panel-heading">
                <div>
                  <h2>Executive Alerts</h2>
                  <p>Items requiring leadership attention</p>
                </div>
                <span className="alert-count">4</span>
              </div>
              <div className="alert">
                <span className="alert-icon red">!</span>
                <div>
                  <strong>Discount compression detected</strong>
                  <p>Professional Services exceeded cap by 2.1%</p>
                  <small>18 min ago</small>
                </div>
                <button>›</button>
              </div>
              <div className="alert">
                <span className="alert-icon amber">⌁</span>
                <div>
                  <strong>3 renewals at risk</strong>
                  <p>₹4.2M ARR due within 30 days</p>
                  <small>1 hr ago</small>
                </div>
                <button>›</button>
              </div>
              <div className="alert">
                <span className="alert-icon blue">↗</span>
                <div>
                  <strong>Strong regional momentum</strong>
                  <p>APAC is 18% above quarterly target</p>
                  <small>3 hrs ago</small>
                </div>
                <button>›</button>
              </div>
              <button className="text-button">View all alerts →</button>
            </article>
          </section>
          <section className="panel table-panel">
            <div className="panel-heading table-header">
              <div>
                <h2>Commercial Rep Performance</h2>
                <p>Quota attainment, bookings, and discount discipline by rep</p>
              </div>
              <button className="outline-button">Customize columns ⚙</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>COMMERCIAL REP</th>
                    <th>QUOTA ATTAINMENT</th>
                    <th>WON DEALS</th>
                    <th>WON REVENUE</th>
                    <th>AVG. DISCOUNT</th>
                    <th>APPROVALS</th>
                    <th>MARGIN</th>
                    <th>RISK</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReps.map((rep) => (
                    <tr key={rep[1]}>
                      <td>
                        <div className="rep">
                          <span>{rep[0]}</span>
                          <div>
                            <strong>{rep[1]}</strong>
                            <small>{rep[2]}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="quota">
                          <div>
                            <i style={{ width: rep[3] }}></i>
                          </div>
                          <b>{rep[3]}</b>
                        </div>
                      </td>
                      <td>{rep[4]}</td>
                      <td>
                        <strong>{rep[5]}</strong>
                      </td>
                      <td className={rep[6] === "12.5%" ? "danger-text" : ""}>
                        {rep[6]}
                      </td>
                      <td>
                        <span
                          className={`status ${rep[7].includes("Escalation") ? "red-status" : rep[7].includes("Review") ? "amber-status" : "green-status"}`}
                        >
                          {rep[7]}
                        </span>
                      </td>
                      <td>{rep[6] === "12.5%" ? "19.0%" : "24.6%"}</td>
                      <td>
                        <span
                          className={`risk ${rep[8] === "D" ? "risk-d" : rep[8] === "B" ? "risk-b" : ""}`}
                        >
                          {rep[8]} Risk
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>
                Showing <b>{filteredReps.length}</b> of <b>28</b> Commercial Reps <i>|</i>{" "}
                Quota cohort: FY25 Q3 Regular
              </span>
              <div>
                <button
                  disabled={page === 1}
                  onClick={() => setPage(Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <button className="current">{page}</button>
                <button onClick={() => setPage(Math.min(3, page + 1))}>
                  {page === 3 ? 3 : 2}
                </button>
                <button onClick={() => setPage(3)}>3</button>
                <button onClick={() => setPage(Math.min(3, page + 1))}>Next</button>
              </div>
            </div>
          </section>
          <footer>
            <span>
              <i></i>Data Pipeline: Live synced from ERP & CPQ Core 12 minutes ago
            </span>
            <span>
              Confidential - Internal CFO & Sales Ops Committee Distribution Only &nbsp;
              DealFlow360 v4.8 Enterprise
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
