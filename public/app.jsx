const { useEffect, useMemo, useState } = React;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function StatusTag({ status }) {
  const text = status || 'processing';
  return <span className={`tag ${text}`}>{text}</span>;
}

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('Admin@12345');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      onLogin(payload.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <section className="panel login-card">
        <div className="brand">
          <h1>Rapid Indexer Pro</h1>
          <p>Professional URL indexing command center</p>
        </div>

        <form className="form-grid" onSubmit={submit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
          </label>

          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete="current-password"
            />
          </label>

          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="error-msg">{error}</div>
        </form>

        <div className="helper-row">
          Seeded users: <strong>admin / Admin@12345</strong> and <strong>manager / Manager@12345</strong>
        </div>
      </section>
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <article className="panel kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </article>
  );
}

function Dashboard({ user, onLogout }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [sites, setSites] = useState([]);
  const [siteConnection, setSiteConnection] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [urlInput, setUrlInput] = useState('');
  const [notice, setNotice] = useState('');
  const [siteNotice, setSiteNotice] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteForm, setSiteForm] = useState({ siteUrl: '', sitemapUrl: '' });

  async function loadAll(filterOverride = historyFilter) {
    const [analytics, list] = await Promise.all([
      api('/api/analytics/overview'),
      api(`/api/urls/history?limit=150${filterOverride === 'all' ? '' : `&status=${filterOverride}`}`)
    ]);

    setStats(analytics);
    setHistory(list.items || []);
    setSites(analytics.managedSites || []);
    setSiteConnection(analytics.searchConsoleConnection || null);
  }

  useEffect(() => {
    let timer;

    async function start() {
      try {
        await loadAll('all');
      } catch (err) {
        if (String(err.message).toLowerCase().includes('unauthorized')) {
          onLogout(true);
        }
      }

      timer = setInterval(async () => {
        try {
          await loadAll();
        } catch {
          // silently skip auto-refresh errors
        }
      }, 5000);
    }

    start();
    return () => clearInterval(timer);
  }, []);

  async function submitUrl(e) {
    e.preventDefault();
    setNotice('');
    if (!urlInput.trim()) return;

    setSubmitBusy(true);
    try {
      const res = await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({ url: urlInput.trim() })
      });
      const firstSubmission = res.submissions?.[0];
      setNotice(
        `${res.message}${firstSubmission ? `. Job ID: ${firstSubmission.id}` : ''}${
          res.skipped?.length ? ` Skipped: ${res.skipped.length}` : ''
        }`
      );
      setUrlInput('');
      await loadAll();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setSubmitBusy(false);
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // no-op
    }
    onLogout(false);
  }

  async function updateFilter(value) {
    setHistoryFilter(value);
    try {
      await loadAll(value);
    } catch {
      // no-op
    }
  }

  async function importSites() {
    setSiteBusy(true);
    setSiteNotice('');
    try {
      const res = await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({ command: 'importSearchConsole' })
      });
      setSiteNotice(`${res.message}. Imported: ${res.count}`);
      await loadAll();
    } catch (err) {
      setSiteNotice(err.message);
    } finally {
      setSiteBusy(false);
    }
  }

  async function syncEnabledSites() {
    setSiteBusy(true);
    setSiteNotice('');
    try {
      const res = await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({ command: 'syncEnabledManagedSites' })
      });
      setSiteNotice(`${res.message}. Sites processed: ${res.count}`);
      await loadAll();
    } catch (err) {
      setSiteNotice(err.message);
    } finally {
      setSiteBusy(false);
    }
  }

  async function syncSite(siteId) {
    setSiteBusy(true);
    setSiteNotice('');
    try {
      const res = await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({ command: 'syncManagedSite', siteId })
      });
      setSiteNotice(`${res.message}. Queued: ${res.queuedCount}, skipped: ${res.skippedCount}`);
      await loadAll();
    } catch (err) {
      setSiteNotice(err.message);
    } finally {
      setSiteBusy(false);
    }
  }

  async function updateSite(siteId, patch) {
    setSiteBusy(true);
    setSiteNotice('');
    try {
      await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({
          command: 'updateManagedSite',
          siteId,
          ...patch
        })
      });
      await loadAll();
    } catch (err) {
      setSiteNotice(err.message);
    } finally {
      setSiteBusy(false);
    }
  }

  async function saveManagedSite(e) {
    e.preventDefault();
    setSiteBusy(true);
    setSiteNotice('');
    try {
      const sitemapUrls = siteForm.sitemapUrl
        ? siteForm.sitemapUrl
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];

      const res = await api('/api/urls/submit', {
        method: 'POST',
        body: JSON.stringify({
          command: 'saveManagedSite',
          siteUrl: siteForm.siteUrl.trim(),
          sitemapUrls
        })
      });
      setSiteNotice(`${res.message}: ${res.site.siteUrl}`);
      setSiteForm({ siteUrl: '', sitemapUrl: '' });
      await loadAll();
    } catch (err) {
      setSiteNotice(err.message);
    } finally {
      setSiteBusy(false);
    }
  }

  const bars = useMemo(() => {
    if (!stats?.last7Days?.length) return [];
    const max = Math.max(1, ...stats.last7Days.map((d) => d.total));
    return stats.last7Days.map((d) => ({
      ...d,
      height: Math.max(10, Math.round((d.total / max) * 165))
    }));
  }, [stats]);

  const ringStyle = useMemo(() => {
    const value = stats?.indexingRate || 0;
    return {
      width: '130px',
      height: '130px',
      borderRadius: '50%',
      background: `conic-gradient(var(--pink) ${value}%, rgba(255,255,255,0.1) ${value}% 100%)`,
      display: 'grid',
      placeItems: 'center',
      margin: '0.4rem auto 0.8rem'
    };
  }, [stats]);

  if (!stats) {
    return (
      <div className="app-shell">
        <section className="panel" style={{ padding: '1.2rem' }}>
          Loading dashboard...
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="panel topbar">
        <div>
          <h2>Rapid Indexer Pro</h2>
          <p>Track indexing velocity, quality, and request outcomes in near real-time</p>
        </div>

        <div className="top-actions">
          <span className="badge">{user.username}</span>
          <span className="badge">{user.role}</span>
          <button className="btn-ghost" onClick={logout}>Logout</button>
        </div>
      </header>

      <section className="panel submit-panel">
        <form className="submit-row" onSubmit={submitUrl}>
          <input
            placeholder="https://example.com/page"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            type="url"
            required
          />
          <button className="btn-primary" disabled={submitBusy} type="submit">
            {submitBusy ? 'Submitting...' : 'Submit URL'}
          </button>
        </form>
        <div className="notice">{notice}</div>
      </section>

      <section className="grid kpi-grid">
        <KpiCard label="Indexed Today" value={stats.indexed.day} />
        <KpiCard label="Indexed This Week" value={stats.indexed.week} />
        <KpiCard label="Indexed This Month" value={stats.indexed.month} />
        <KpiCard label="Indexed This Year" value={stats.indexed.year} />
        <KpiCard label="Total Indexed" value={stats.indexed.total} />
        <KpiCard label="Total Submitted" value={stats.totals.submitted} />
        <KpiCard label="Successful" value={stats.totals.successful} />
        <KpiCard label="Unsuccessful" value={stats.totals.unsuccessful} />
        <KpiCard label="In Progress" value={stats.totals.processing} />
        <KpiCard label="Indexing %" value={`${stats.indexingRate}%`} />
      </section>

      <section className="grid layout-2">
        <article className="panel block">
          <h3>7-Day Submission Activity</h3>
          <div className="chart">
            {bars.map((day) => (
              <div key={day.date} className="bar-col" title={`${day.date}: total ${day.total}, success ${day.success}, rejected ${day.rejected}`}>
                <div className="bar-bg" style={{ height: `${day.height}px` }} />
                <div className="day-label">{day.date.slice(5)}</div>
              </div>
            ))}
          </div>
          <div className="legend">
            <span className="pill success">Successful: {stats.totals.successful}</span>
            <span className="pill rejected">Rejected: {stats.totals.unsuccessful}</span>
            <span className="pill processing">Processing: {stats.totals.processing}</span>
          </div>
        </article>

        <article className="panel block">
          <h3>Quality Snapshot</h3>
          <div style={ringStyle}>
            <div
              style={{
                width: '86px',
                height: '86px',
                borderRadius: '50%',
                background: 'rgba(7, 20, 47, 0.95)',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800
              }}
            >
              {stats.indexingRate}%
            </div>
          </div>

          <div className="stats-list">
            <div><span>Average processing time</span><strong>{stats.avgProcessingSeconds}s</strong></div>
            <div><span>Recent success rate (last 20)</span><strong>{stats.recentSuccessRate}%</strong></div>
            <div><span>Current queue</span><strong>{stats.totals.processing}</strong></div>
            <div><span>Total requests tracked</span><strong>{stats.totals.submitted}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="table-head">
          <div>
            <h3 style={{ margin: 0 }}>Managed Sites</h3>
            <div className="helper-row" style={{ marginTop: '0.3rem' }}>
              Search Console: {siteConnection?.configured ? `connected as ${siteConnection.serviceAccountEmail}` : 'not configured'}
            </div>
          </div>
          <div className="table-actions">
            <button className="btn-ghost" disabled={siteBusy} onClick={importSites}>Import Search Console</button>
            <button className="btn-ghost" disabled={siteBusy} onClick={syncEnabledSites}>Sync Enabled Sites</button>
          </div>
        </div>

        <div className="site-form-wrap">
          <form className="site-form" onSubmit={saveManagedSite}>
            <input
              placeholder="https://www.example.com/ or sc-domain:example.com"
              value={siteForm.siteUrl}
              onChange={(e) => setSiteForm((current) => ({ ...current, siteUrl: e.target.value }))}
              required
            />
            <input
              placeholder="Optional sitemap URLs, comma-separated"
              value={siteForm.sitemapUrl}
              onChange={(e) => setSiteForm((current) => ({ ...current, sitemapUrl: e.target.value }))}
            />
            <button className="btn-primary" disabled={siteBusy} type="submit">
              {siteBusy ? 'Saving...' : 'Add Managed Site'}
            </button>
          </form>
          <div className="notice">{siteNotice}</div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Permission</th>
                <th>Sitemaps</th>
                <th>Last Sync</th>
                <th>Queued</th>
                <th>Skipped</th>
                <th>Enabled</th>
                <th>Auto Sync</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr>
                  <td colSpan="9">No managed sites configured yet.</td>
                </tr>
              ) : (
                sites.map((site) => (
                  <tr key={site.id}>
                    <td>
                      <div>{site.label || site.siteUrl}</div>
                      <div className="table-subtle">{site.siteUrl}</div>
                    </td>
                    <td>{site.permissionLevel || '-'}</td>
                    <td>{site.sitemapUrls?.length || 0}</td>
                    <td>
                      <div>{formatDate(site.lastSyncAt)}</div>
                      <div className="table-subtle">{site.lastSyncStatus || 'never'}</div>
                    </td>
                    <td>{site.lastSyncQueuedCount || 0}</td>
                    <td>{site.lastSyncSkippedCount || 0}</td>
                    <td>{site.enabled === false ? 'No' : 'Yes'}</td>
                    <td>{site.autoSyncEnabled === false ? 'No' : 'Yes'}</td>
                    <td>
                      <div className="action-stack">
                        <button
                          className="btn-ghost"
                          disabled={siteBusy}
                          onClick={() => updateSite(site.id, { enabled: site.enabled === false })}
                        >
                          {site.enabled === false ? 'Enable' : 'Disable'}
                        </button>
                        <button
                          className="btn-ghost"
                          disabled={siteBusy}
                          onClick={() =>
                            updateSite(site.id, {
                              autoSyncEnabled: site.autoSyncEnabled === false
                            })
                          }
                        >
                          {site.autoSyncEnabled === false ? 'Auto Sync On' : 'Auto Sync Off'}
                        </button>
                        <button className="btn-ghost" disabled={siteBusy} onClick={() => syncSite(site.id)}>
                          Sync Now
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="table-head">
          <h3 style={{ margin: 0 }}>URL Submission History</h3>
          <div className="table-actions">
            <select value={historyFilter} onChange={(e) => updateFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="success">Successful</option>
              <option value="rejected">Rejected</option>
              <option value="processing">Processing</option>
            </select>
            <button className="btn-ghost" onClick={() => loadAll()}>Refresh</button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Submitted</th>
                <th>Processed</th>
                <th>Status</th>
                <th>Search Console</th>
                <th>Helpers</th>
                <th>HTTP</th>
                <th>Latency</th>
                <th>Reason</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan="10">No records yet.</td>
                </tr>
              ) : (
                history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.url}</td>
                    <td>{formatDate(item.submittedAt)}</td>
                    <td>{formatDate(item.processedAt)}</td>
                    <td><StatusTag status={item.status} /></td>
                    <td>
                      {item.searchConsoleInspection?.verdict
                        ? `${item.searchConsoleInspection.verdict} / ${item.searchConsoleInspection.coverageState || '-'}`
                        : item.searchConsoleInspection?.reason || '-'}
                    </td>
                    <td>
                      {item.helperUrls?.length ? (
                        <div className="helper-links">
                          {item.helperUrls.map((link) => (
                            <a key={link.label + link.href} href={link.href} rel="noreferrer" target="_blank">
                              {link.label}
                            </a>
                          ))}
                        </div>
                      ) : '-'}
                    </td>
                    <td>{item.httpStatus || '-'}</td>
                    <td>{item.latencyMs ? `${(item.latencyMs / 1000).toFixed(2)}s` : '-'}</td>
                    <td>{item.reason || '-'}</td>
                    <td>{item.requestedBy || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* <div className="footer-note">
          Note: Google indexing is not guaranteed for every public URL. This platform optimizes and tracks indexing readiness and submission outcomes quickly.
        </div> */}
      </section>
    </div>
  );
}

function App() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    async function bootstrap() {
      try {
        const payload = await api('/api/auth/me');
        setUser(payload.user);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
  }, []);

  if (loading) {
    return (
      <div className="app-shell" style={{ paddingTop: '2rem' }}>
        <section className="panel" style={{ padding: '1rem' }}>
          Bootstrapping application...
        </section>
      </div>
    );
  }

  return user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <LoginScreen onLogin={(u) => setUser(u)} />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
