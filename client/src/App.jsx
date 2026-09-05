import { useEffect, useMemo, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
const statuses = ["RESERVED", "CONFIRMED", "CHECKED_IN", "CANCELLED", "EXPIRED"];

async function api(path, options = {}) {
  const token = localStorage.getItem("event_token");
  const headers = { ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data;
}

function formatDate(value, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", ...(withTime ? { timeStyle: "short" } : {}) }).format(new Date(value));
}

function Login({ onLogin }) {
  const [form, setForm] = useState({ email: "organizer@test.com", password: "Organizer@123" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError("");
    try { const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(form) }); localStorage.setItem("event_token", data.token); onLogin(data.user); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="login-shell"><div className="login-card"><div className="brand-mark">ER</div><h1>Event Registration</h1><p className="muted">Sign in to manage events, registrations and check-ins.</p><form onSubmit={submit} className="stack"><label>Email<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></label><label>Password<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></label>{error && <div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form><div className="demo-box"><strong>Demo accounts</strong><div>Organizer: organizer@test.com / Organizer@123</div><div>Staff: staff@test.com / Staff@12345</div></div></div></div>;
}

function Sidebar({ page, setPage, user, alertCount, logout }) {
  const items = user.role === "ORGANIZER" ? ["dashboard", "events", "registrations", "staff"] : ["sessions", "registrations"];
  return <aside className="sidebar"><div className="logo"><span>ER</span><div><strong>EventDesk</strong><small>Registration</small></div></div><nav>{items.map(item => <button key={item} className={page === item ? "nav-item active" : "nav-item"} onClick={() => setPage(item)}>{item === "dashboard" ? "▦" : item === "events" ? "◫" : item === "registrations" ? "☷" : item === "staff" ? "♙" : "◷"}<span>{item.replace("sessions", "My Sessions").replace("dashboard", "Dashboard").replace("events", "Events").replace("registrations", "Registrations").replace("staff", "Staff")}</span>{item === "dashboard" && alertCount > 0 && <b className="badge">{alertCount}</b>}</button>)}</nav><div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{user.name?.slice(0,1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.role === "ORGANIZER" ? "Organizer" : "Check-in Staff"}</small></div></div><button className="logout" onClick={logout}>Sign out</button></div></aside>;
}

function Dashboard({ alerts, refreshAlerts, setPage }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  async function load() { try { setLoading(true); setError(""); setData(await api("/api/dashboard")); await refreshAlerts(); } catch (e) { setError(e.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  async function dismiss(id) { try { await api(`/api/alerts/${id}/dismiss`, { method: "PATCH" }); await load(); } catch (e) { setError(e.message); } }
  if (loading) return <Loading />;
  if (error) return <PageError message={error} retry={load} />;
  const summary = data.summary || {};
  const cards = [["Sessions today", summary.sessionsToday ?? 0, "◷"], ["Checked in today", summary.checkedInToday ?? 0, "✓"], ["Expired this week", summary.expiredThisWeek ?? 0, "⌁"], ["At capacity", summary.atCapacity ?? 0, "! "]];
  return <div className="page"><Header title="Dashboard" subtitle="A live overview of your event operations." /><div className="metric-grid">{cards.map(([label,value,icon]) => <div className="metric" key={label}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>)}</div>{alerts.length > 0 && <section className="panel alert-panel"><div className="panel-title"><div><h2>Capacity alerts</h2><p>Sessions that currently have no remaining seats.</p></div><span className="alert-count">{alerts.length}</span></div>{alerts.map(a => <div className="alert-row" key={a.id}><div><strong>{a.session?.title}</strong><span>{a.message}</span></div><button onClick={() => dismiss(a.id)}>Dismiss</button></div>)}</section>}<div className="two-col"><section className="panel"><div className="panel-title"><div><h2>Status breakdown</h2><p>Current registration lifecycle.</p></div></div>{Object.entries(data.statusBreakdown || {}).map(([k,v]) => <div className="bar-row" key={k}><span>{k.replace("_", " ")}</span><div className="bar"><i style={{ width: `${Math.min(100, v * 10)}%` }} /></div><b>{v}</b></div>)}</section><section className="panel"><div className="panel-title"><div><h2>Check-ins · last 14 days</h2><p>Daily operational trend.</p></div></div><div className="spark-bars">{(data.checkInsLast14Days || []).map(d => <div className="spark-col" key={d.date}><span style={{ height: `${Math.max(6, (d.checkedIn ?? d.count ?? 0) * 18)}px` }} title={`${d.date}: ${d.checkedIn ?? d.count ?? 0}`} /><small>{new Date(d.date).toLocaleDateString("en-IN", { day: "2-digit" })}</small></div>)}</div></section></div><section className="panel"><div className="panel-title"><div><h2>Session capacity</h2><p>Sessions requiring attention.</p></div><button className="link-btn" onClick={() => setPage("events")}>View events →</button></div><Table><thead><tr><th>Session</th><th>Event</th><th>Seats</th><th>Registrations</th></tr></thead><tbody>{(data.sessionBreakdown || []).map(s => <tr key={s.sessionId}><td><strong>{s.sessionTitle || s.title || "—"}</strong></td><td>{s.eventName}</td><td>{s.capacity}</td><td>{["RESERVED","CONFIRMED","CHECKED_IN"].reduce((total, status) => total + (s.statuses?.[status] || 0), 0)}/{s.capacity}</td></tr>)}</tbody></Table></section></div>;
}

function Events({ onChanged }) {
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showArchived, setShowArchived] = useState(true);
  const [form, setForm] = useState({ name: "", description: "", venue: "", startDate: "", endDate: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true); setError("");
      const d = await api(`/api/events?includeArchived=${showArchived}`);
      setEvents(d.events || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [showArchived]);

  function openCreate() {
    setSelected(null); setMessage("");
    setForm({ name: "", description: "", venue: "", startDate: "", endDate: "" });
    setShowEventForm(true);
  }
  function openEdit(ev) {
    setSelected(ev); setMessage("");
    setForm({ name: ev.name || "", description: ev.description || "", venue: ev.venue || "", startDate: ev.startDate?.slice(0, 10) || "", endDate: ev.endDate?.slice(0, 10) || "" });
    setShowEventForm(true);
  }
  async function saveEvent(e) {
    e.preventDefault(); setError(""); setMessage("");
    try {
      const payload = { ...form, startDate: form.startDate || null, endDate: form.endDate || null };
      if (selected) await api(`/api/events/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/api/events", { method: "POST", body: JSON.stringify(payload) });
      setShowEventForm(false); setMessage(selected ? "Event updated successfully." : "Event created successfully.");
      await load(); onChanged?.();
    } catch (e) { setError(e.message); }
  }
  async function toggleArchive(ev) {
    setError(""); setMessage("");
    try {
      await api(`/api/events/${ev.id}/${ev.archivedAt ? "restore" : "archive"}`, { method: "POST" });
      if (selected?.id === ev.id) setSelected(null);
      setMessage(ev.archivedAt ? "Event restored successfully." : "Event archived successfully.");
      await load(); onChanged?.();
    } catch (e) { setError(e.message); }
  }

  return <div className="page">
    <Header title="Events" subtitle="Create events and manage their sessions." action={<button className="primary" onClick={openCreate}>+ New event</button>} />
    <div className="toolbar-row">
      <div className="muted">{events.length} event{events.length === 1 ? "" : "s"}</div>
      <label className="check-label"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived</label>
    </div>
    {error && <div className="error page-error">{error}</div>}
    {message && <div className="success page-error">{message}</div>}
    {loading ? <Loading /> : events.length === 0 ? <section className="panel"><Empty text="No events found." /></section> :
      <div className="event-grid">{events.map(ev => <div className={`event-card ${ev.archivedAt ? "archived" : ""}`} key={ev.id}>
        <div className="event-top"><span className="status-pill">{ev.archivedAt ? "Archived" : "Active"}</span><button className="icon-btn" disabled={!!ev.archivedAt} onClick={() => openEdit(ev)}>Edit</button></div>
        <h2>{ev.name}</h2><p>{ev.description || "No description provided."}</p>
        {ev.venue && <div className="event-meta"><span>⌖ {ev.venue}</span></div>}
        <div className="event-meta"><span>◷ {formatDate(ev.startDate, false)}{ev.endDate ? ` – ${formatDate(ev.endDate, false)}` : ""}</span><span>▦ {ev.sessionCount || 0} sessions</span></div>
        <button className="secondary full" onClick={() => setSelected(selected?.id === ev.id ? null : ev)}>{selected?.id === ev.id ? "Close event" : "Open event"}</button>
        <button className="text-danger" onClick={() => toggleArchive(ev)}>{ev.archivedAt ? "Restore event" : "Archive event"}</button>
        {selected?.id === ev.id && <SessionManager event={ev} />}
      </div>)}</div>}

    {showEventForm && <Modal title={selected ? "Edit event" : "Create event"} onClose={() => setShowEventForm(false)}>
      <form onSubmit={saveEvent} className="stack">
        <label>Event name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength="200" required /></label>
        <label>Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What is this event about?" /></label>
        <label>Venue<input value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} maxLength="200" placeholder="e.g. Convention Center, Bhopal" /></label>
        <div className="form-grid"><label>Start date<input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></label><label>End date<input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></label></div>
        <button className="primary">{selected ? "Save changes" : "Create event"}</button>
      </form>
    </Modal>}
  </div>;
}

function SessionManager({ event }) {
  const [sessions, setSessions] = useState([]), [show, setShow] = useState(false), [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: "", startTime: "", duration: 60, location: "", capacity: 20 });
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [message, setMessage] = useState("");

  async function load() {
    try { setLoading(true); setError(""); const d = await api(`/api/events/${event.id}/sessions`); setSessions(d.sessions || []); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [event.id]);

  function openCreate() { setEditing(null); setMessage(""); setForm({ title: "", startTime: "", duration: 60, location: "", capacity: 20 }); setShow(true); }
  function openEdit(s) { setEditing(s); setMessage(""); setForm({ title: s.title || "", startTime: s.startTime ? new Date(s.startTime).toISOString().slice(0, 16) : "", duration: s.duration || 60, location: s.location || "", capacity: s.capacity || 20 }); setShow(true); }
  async function save(e) {
    e.preventDefault(); setError(""); setMessage("");
    try {
      const payload = { title: form.title, startTime: new Date(form.startTime).toISOString(), duration: Number(form.duration), location: form.location, capacity: Number(form.capacity) };
      if (editing) await api(`/api/sessions/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api(`/api/events/${event.id}/sessions`, { method: "POST", body: JSON.stringify(payload) });
      setShow(false); setMessage(editing ? "Session updated successfully." : "Session created successfully."); await load();
    } catch (e) { setError(e.message); }
  }
  async function remove(s) {
    if (!window.confirm(`Delete session "${s.title}"?`)) return;
    try { setError(""); await api(`/api/sessions/${s.id}`, { method: "DELETE" }); setMessage("Session deleted successfully."); await load(); }
    catch (e) { setError(e.message); }
  }

  return <div className="sessions-box">
    <div className="mini-head"><div><strong>Sessions</strong><small className="muted session-count">{sessions.length} session{sessions.length === 1 ? "" : "s"}</small></div>{!event.archivedAt && <button className="link-btn" onClick={openCreate}>+ Add session</button>}</div>
    {message && <div className="success">{message}</div>}{error && <div className="error">{error}</div>}
    {loading ? <div className="muted">Loading sessions…</div> : sessions.length === 0 ? <div className="empty compact">No sessions yet. Add the first session for this event.</div> :
      <div className="session-list">{sessions.map(s => <div className="session-detail" key={s.id}>
        <div className="session-detail-main"><div><strong>{s.title}</strong><small>◷ {formatDate(s.startTime)} · {s.duration} min</small><small>⌂ {s.location}</small></div><div className="capacity-chip">{s._count?.registrations ?? s.registrationCount ?? 0}/{s.capacity} occupied</div></div>
        {!event.archivedAt && <div className="session-actions"><button className="icon-btn" onClick={() => openEdit(s)}>Edit</button><button className="icon-btn danger-btn" onClick={() => remove(s)}>Delete</button></div>}
      </div>)}</div>}

    {show && <Modal title={editing ? "Edit session" : "Add session"} onClose={() => setShow(false)}>
      <form onSubmit={save} className="stack">
        <label>Session title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required /></label>
        <label>Start time<input type="datetime-local" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} required /></label>
        <div className="form-grid"><label>Duration (minutes)<input type="number" min="1" value={form.duration} onChange={e => setForm({ ...form, duration: e.target.value })} required /></label><label>Capacity<input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} required /></label></div>
        <label>Location<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} required /></label>
        <button className="primary">{editing ? "Save changes" : "Create session"}</button>
      </form>
    </Modal>}
  </div>;
}

function Registrations({user}) {
  const [data,setData]=useState(null), [events,setEvents]=useState([]);
  const [filters,setFilters]=useState({search:"",eventId:"",sessionId:"",status:"",sort:"reservedAt",order:"desc",page:1});
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[history,setHistory]=useState(null);
  const [sessions,setSessions]=useState([]),[showCreate,setShowCreate]=useState(false),[showImport,setShowImport]=useState(false);
  const [createForm,setCreateForm]=useState({sessionId:"",name:"",email:"",phone:""});
  const [importFile,setImportFile]=useState(null),[importResult,setImportResult]=useState(null),[busy,setBusy]=useState(false);

  async function loadEvents(){try{const d=await api("/api/events");setEvents(d.events||d.data||[])}catch(e){setError(e.message)}}
  async function loadSessions(eventId){
    if(!eventId){setSessions([]);setFilters(f=>({...f,sessionId:"",page:1}));return;}
    try{const d=await api(`/api/events/${eventId}/sessions`);setSessions(d.sessions||d.data||[])}catch(e){setError(e.message)}
  }
  async function load(){
    try{setLoading(true);setError("");
      const q={page:filters.page,pageSize:10,search:filters.search,eventId:filters.eventId,sessionId:filters.sessionId,status:filters.status,sort:filters.sort,order:filters.order};
      setData(await api(`/api/registrations?${new URLSearchParams(q)}`));
    }catch(e){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{loadEvents()},[]); useEffect(()=>{loadSessions(filters.eventId)},[filters.eventId]); useEffect(()=>{load()},[filters]);

  function changeFilter(patch){setFilters(f=>({...f,...patch,page:1}))}
  async function update(id,status){try{setError("");await api(`/api/registrations/${id}/status`,{method:"PATCH",body:JSON.stringify({status})});await load()}catch(e){setError(e.message)}}
  async function openHistory(id){try{setHistory(await api(`/api/registrations/${id}/history`))}catch(e){setError(e.message)}}
  async function exportCsv(){
    try{const qs=new URLSearchParams({search:filters.search,eventId:filters.eventId,sessionId:filters.sessionId,status:filters.status,sort:filters.sort,order:filters.order});const token=localStorage.getItem("event_token");const r=await fetch(`${API}/api/registrations/export?${qs}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(await r.text());const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="check-in-sheet.csv";a.click();URL.revokeObjectURL(url)}catch(e){setError(e.message)}}
  async function createRegistration(e){
    e.preventDefault();setBusy(true);setError("");
    try{await api("/api/registrations",{method:"POST",body:JSON.stringify(createForm)});setShowCreate(false);setCreateForm({sessionId:"",name:"",email:"",phone:""});await load()}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function importCsv(e){
    e.preventDefault();if(!importFile)return;
    setBusy(true);setError("");setImportResult(null);
    try{const fd=new FormData();fd.append("file",importFile);const result=await api("/api/registrations/import",{method:"POST",body:fd});setImportResult(result);await load()}catch(e){setError(e.message)}finally{setBusy(false)}
  }

  const allSessions=events.flatMap(ev=>(ev.sessions||[]).map(s=>({...s,eventName:ev.name,eventId:ev.id})));
  return <div className="page">
    <Header title="Registrations" subtitle="Search, filter and manage attendees across sessions." action={<div className="header-actions"><button className="secondary" onClick={exportCsv}>Export CSV</button>{user.role==="ORGANIZER"&&<><button className="secondary" onClick={()=>setShowImport(true)}>Import CSV</button><button className="primary" onClick={()=>setShowCreate(true)}>+ Registration</button></>}</div>}/>
    <div className="filters registration-filters">
      <input placeholder="Search name or email…" value={filters.search} onChange={e=>changeFilter({search:e.target.value})}/>
      <select value={filters.eventId} onChange={e=>changeFilter({eventId:e.target.value})}><option value="">All events</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
      <select value={filters.sessionId} onChange={e=>changeFilter({sessionId:e.target.value})}><option value="">All sessions</option>{(filters.eventId ? sessions : allSessions).map(s=><option key={s.id} value={s.id}>{filters.eventId ? s.title : `${s.eventName} — ${s.title}`}</option>)}</select>
      <select value={filters.status} onChange={e=>changeFilter({status:e.target.value})}><option value="">All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>
      <select value={filters.sort} onChange={e=>changeFilter({sort:e.target.value})}><option value="reservedAt">Reserved time</option><option value="status">Status</option><option value="session">Session</option></select>
      <select value={filters.order} onChange={e=>changeFilter({order:e.target.value})}><option value="desc">Newest / Z-A</option><option value="asc">Oldest / A-Z</option></select>
    </div>
    {error&&<div className="error page-error">{error}</div>}
    {loading?<Loading/>:<section className="panel"><div className="panel-title"><div><h2>All registrations</h2><p>{data?.pagination?.total||0} matching registrations</p></div></div>
      <Table><thead><tr><th>Attendee</th><th>Session</th><th>Event</th><th>Status</th><th>Reserved</th><th>Actions</th></tr></thead><tbody>
      {(data?.data||[]).map(r=><tr key={r.id}><td><strong>{r.name}</strong><small>{r.email}</small></td><td>{r.session?.title}</td><td>{r.session?.event?.name}</td><td><span className={`status ${r.status.toLowerCase()}`}>{r.status.replace("_"," ")}</span></td><td>{formatDate(r.reservedAt)}</td><td><div className="row-actions">
        {r.status==="RESERVED"&&user.role==="ORGANIZER"&&<button onClick={()=>update(r.id,"CONFIRMED")}>Confirm</button>}
        {r.status==="CONFIRMED"&&<button onClick={()=>update(r.id,"CHECKED_IN")}>Check in</button>}
        {["RESERVED","CONFIRMED"].includes(r.status)&&<button className="danger-link" onClick={()=>update(r.id,"CANCELLED")}>Cancel</button>}
        <button onClick={()=>openHistory(r.id)}>History</button>
      </div></td></tr>)}</tbody></Table>
      {(data?.data||[]).length===0&&<Empty text="No registrations match these filters."/>}
      <div className="pagination"><span>Page {data?.pagination?.page||1} of {data?.pagination?.totalPages||1}</span><div><button disabled={!data?.pagination?.hasPreviousPage} onClick={()=>setFilters({...filters,page:filters.page-1})}>←</button><button disabled={!data?.pagination?.hasNextPage} onClick={()=>setFilters({...filters,page:filters.page+1})}>→</button></div></div>
    </section>}

    {history&&<Modal title="Registration history" onClose={()=>setHistory(null)}><div className="timeline">{(history.history||[]).map(h=><div className="timeline-item" key={h.id}><span className="dot"/><div><strong>{h.action.replaceAll("_"," ")}</strong><small>{formatDate(h.createdAt)} · {h.actor?.name||"System"}</small>{h.oldStatus&&<p>{h.oldStatus} → {h.newStatus}</p>}{h.note&&<p>{h.note}</p>}</div></div>)}</div></Modal>}
    {showCreate&&<Modal title="New registration" onClose={()=>setShowCreate(false)}><form onSubmit={createRegistration} className="stack"><label>Session<select value={createForm.sessionId} onChange={e=>setCreateForm({...createForm,sessionId:e.target.value})} required><option value="">Select session</option>{allSessions.map(s=><option key={s.id} value={s.id}>{s.eventName} — {s.title}</option>)}</select></label><label>Attendee name<input value={createForm.name} onChange={e=>setCreateForm({...createForm,name:e.target.value})} required /></label><label>Email<input type="email" value={createForm.email} onChange={e=>setCreateForm({...createForm,email:e.target.value})} required /></label><label>Phone<input value={createForm.phone} onChange={e=>setCreateForm({...createForm,phone:e.target.value})}/></label><button className="primary" disabled={busy}>{busy?"Creating…":"Create registration"}</button></form></Modal>}
    {showImport&&<Modal title="Import registrations" onClose={()=>setShowImport(false)}><form onSubmit={importCsv} className="stack"><p className="muted small-note">CSV columns: <strong>sessionId,name,email</strong> and optional <strong>phone</strong>. Maximum 1000 rows / 2 MB.</p><label>CSV file<input type="file" accept=".csv,text/csv" onChange={e=>setImportFile(e.target.files?.[0]||null)} required /></label><button className="primary" disabled={busy}>{busy?"Importing…":"Import CSV"}</button></form>{importResult&&<div className="import-result"><div className="success">Import complete.</div><div className="import-summary"><span>Created <b>{importResult.created??importResult.summary?.created??0}</b></span><span>Duplicates <b>{importResult.duplicates??importResult.summary?.duplicates??0}</b></span><span>Rejected <b>{importResult.rejected??importResult.summary?.rejected??0}</b></span></div><div className="import-rows">{(importResult.results||importResult.rows||[]).map((row,i)=><div key={i}><span>{row.row??i+1}</span><strong>{row.status}</strong><small>{row.reason||row.message||row.email||""}</small></div>)}</div></div>}</Modal>}
  </div>;
}

function MySessions(){
  const [data,setData]=useState([]),[error,setError]=useState("");
  async function load(){
    try{
      const d=await api("/api/staff/me/sessions");
      setData(d.sessions||d.data||[]);
    }catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[]);
  return <div className="page">
    <Header title="My Sessions" subtitle="Sessions assigned to you for check-in."/>
    {error&&<div className="error page-error">{error}</div>}
    <div className="session-grid">
      {data.map(item=>{
        const session=item.session||item;
        const event=item.event||session.event||{};
        return <div className="panel session-card" key={item.assignmentId||session.id}>
          <span className="status-pill">Assigned</span>
          <h2>{session.title||"Session"}</h2>
          <p>{event.name||"Event"}</p>
          <div className="event-meta">
            <span>◷ {formatDate(session.startTime)}</span>
            <span>⌂ {session.location||"—"}</span>
          </div>
          <div className="muted small-note">
            {session.registrationCount??0} registrations · {session.capacity??0} capacity
          </div>
        </div>
      })}
      {data.length===0&&!error&&<Empty text="No sessions assigned yet."/>}
    </div>
  </div>
}

function Staff(){
  const [events,setEvents]=useState([]),[selected,setSelected]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);

  async function load(){
    try{
      setLoading(true);
      setError("");
      const e=await api("/api/events?includeArchived=true");
      const eventList=e.events||e.data||[];
      const hydrated=await Promise.all(eventList.map(async event=>{
        try{
          const s=await api(`/api/events/${event.id}/sessions`);
          return {...event,sessions:s.sessions||s.data||[]};
        }catch{
          return {...event,sessions:[]};
        }
      }));
      setEvents(hydrated);
    }catch(e){setError(e.message)}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[]);
  const sessions=events.flatMap(e=>(e.sessions||[]).map(s=>({...s,eventName:e.name,eventArchived:!!e.archivedAt})));

  async function assign(sessionId){
    if(!selected){setError("Enter the CHECKIN_STAFF user ID first.");return;}
    try{setBusy(true);setError("");setMessage("");await api(`/api/sessions/${sessionId}/staff`,{method:"POST",body:JSON.stringify({userId:selected})});setMessage("Staff member assigned successfully.");await load()}catch(e){setError(e.message)}finally{setBusy(false)}
  }

  async function remove(sessionId){
    if(!selected){setError("Enter the CHECKIN_STAFF user ID first.");return;}
    try{setBusy(true);setError("");setMessage("");await api(`/api/sessions/${sessionId}/staff/${selected}`,{method:"DELETE"});setMessage("Staff member removed successfully.");await load()}catch(e){setError(e.message)}finally{setBusy(false)}
  }

  return <div className="page"><Header title="Staff assignment" subtitle="Assign check-in staff to sessions."/>
    {error&&<div className="error page-error">{error}</div>}{message&&<div className="success page-error">{message}</div>}
    <section className="panel"><div className="panel-title"><div><h2>Assignment workspace</h2><p>Choose the check-in staff account and manage session assignments.</p></div></div>
      <div className="staff-selector"><label>Staff user ID<input value={selected} onChange={e=>setSelected(e.target.value.trim())} placeholder="Paste CHECKIN_STAFF user ID"/></label><button type="button" className="secondary" onClick={()=>setSelected("cmtmwt3h00000pcvunvjokrfo")}>Use demo staff</button></div>
      <p className="muted small-note">The API remains the source of truth for role and assignment authorization. Use a real CHECKIN_STAFF user ID.</p>
    </section>
    <section className="panel"><div className="panel-title"><div><h2>Session assignments</h2><p>{loading ? "Loading sessions…" : `${sessions.length} session${sessions.length===1?"":"s"} available`}</p></div></div>
      {loading?<Loading/>:<Table><thead><tr><th>Session</th><th>Event</th><th>Schedule</th><th>Assigned staff</th><th>Actions</th></tr></thead><tbody>{sessions.map(s=><tr key={s.id}><td><strong>{s.title}</strong></td><td>{s.eventName}</td><td>{formatDate(s.startTime)}</td><td>{s.staffCount??0}</td><td><div className="row-actions"><button className="secondary" disabled={!selected||busy||s.eventArchived} onClick={()=>assign(s.id)}>Assign</button>{(s.staffCount??0)>0&&<button className="danger-link" disabled={!selected||busy} onClick={()=>remove(s.id)}>Remove</button>}</div></td></tr>)}</tbody></Table>}
      {!loading&&sessions.length===0&&<Empty text="No sessions available."/>}
    </section>
  </div>;
}

function Header({title,subtitle,action}){return <div className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>}
function Table({children}){return <div className="table-wrap"><table>{children}</table></div>}
function Modal({title,onClose,children}){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal"><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}>×</button></div>{children}</div></div>}
function Loading(){return <div className="loading"><span/>Loading…</div>}
function Empty({text}){return <div className="empty">{text}</div>}
function PageError({message,retry}){return <div className="empty"><div className="error">{message}</div><button className="secondary" onClick={retry}>Retry</button></div>}

export default function App(){
  const [user,setUser]=useState(null);
  const [page,setPage]=useState(null);
  const [alerts,setAlerts]=useState([]);

  useEffect(()=>{
    const token=localStorage.getItem("event_token");
    if(!token){
      setPage(null);
      return;
    }

    api("/api/auth/me")
      .then(d=>{
        setUser(d.user);
        // Important: after a browser refresh, React state resets.
        // Restore the correct default page from the authenticated role.
        setPage(d.user.role==="ORGANIZER" ? "dashboard" : "sessions");
      })
      .catch(()=>{
        localStorage.removeItem("event_token");
        setUser(null);
        setPage(null);
      });
  },[]);

  async function refreshAlerts(){
    try{
      const d=await api("/api/alerts");
      setAlerts((d.alerts||[]).filter(alert => !alert.dismissed));
    }catch{
      setAlerts([]);
    }
  }

  useEffect(()=>{
    if(user?.role==="ORGANIZER"){
      refreshAlerts();
      const id=setInterval(refreshAlerts,30000);
      return()=>clearInterval(id);
    }
    setAlerts([]);
  },[user]);

  function handleLogin(u){
    setUser(u);
    setPage(u.role==="ORGANIZER" ? "dashboard" : "sessions");
  }

  function logout(){
    localStorage.removeItem("event_token");
    setUser(null);
    setPage(null);
    setAlerts([]);
  }

  if(!user)return <Login onLogin={handleLogin}/>;

  let content;
  if(user.role==="CHECKIN_STAFF"){
    content=page==="registrations"
      ? <Registrations user={user}/>
      : <MySessions/>;
  }else{
    content=page==="events"
      ? <Events onChanged={refreshAlerts}/>
      : page==="registrations"
        ? <Registrations user={user}/>
        : page==="staff"
          ? <Staff/>
          : <Dashboard alerts={alerts} refreshAlerts={refreshAlerts} setPage={setPage}/>;
  }

  return <div className="app-shell">
    <Sidebar
      page={page}
      setPage={setPage}
      user={user}
      alertCount={alerts.length}
      logout={logout}
    />
    <main className="main">{content}</main>
  </div>;
}
