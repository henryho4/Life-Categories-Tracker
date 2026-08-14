import React, { useState, useEffect, useCallback } from "react";
import {
  Heart, Briefcase, Users, Wallet, Sprout, Sparkles, Home, Dumbbell,
  BookOpen, Target, PartyPopper, Plus, X, Check, ChevronLeft, Pencil,
  Trash2, Flame, TrendingUp, ArrowUp, ArrowDown, Minus, Award, LogOut, Mail
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot
} from "recharts";
import { supabase } from "./supabaseClient";

// ---------- design tokens ----------
const COLORS = {
  sage: "#5B7B62",
  ochre: "#C08A4E",
  plum: "#7C5C6B",
  teal: "#4A7C82",
  moss: "#74874A",
  clay: "#B15E4D",
  slate: "#55647A",
  berry: "#8C4B5E",
};
const COLOR_LIST = Object.values(COLORS);
const PAPER = "#F4F1EC";
const PAPER_RAISED = "#FBFAF7";
const INK = "#252722";
const INK_SOFT = "#5B5D56";
const HAIRLINE = "#DAD5C9";

const ICONS = { Heart, Briefcase, Users, Wallet, Sprout, Sparkles, Home, Dumbbell, BookOpen, Target, PartyPopper };
const ICON_NAMES = Object.keys(ICONS);

const SUGGESTIONS = [
  { name: "Health & Vitality", icon: "Heart", color: COLORS.sage },
  { name: "Career & Growth", icon: "Briefcase", color: COLORS.ochre },
  { name: "Relationships", icon: "Users", color: COLORS.plum },
  { name: "Finances", icon: "Wallet", color: COLORS.teal },
  { name: "Personal Growth", icon: "Sprout", color: COLORS.moss },
  { name: "Fun & Recreation", icon: "PartyPopper", color: COLORS.clay },
  { name: "Spirituality", icon: "Sparkles", color: COLORS.slate },
  { name: "Home & Environment", icon: "Home", color: COLORS.berry },
];

// ---------- date helpers ----------
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 Sun ... 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function toKey(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function weekLabel(d) {
  const end = addDays(d, 6);
  const optsA = { month: "short", day: "numeric" };
  const sameMonth = d.getMonth() === end.getMonth();
  const a = d.toLocaleDateString(undefined, optsA);
  const b = end.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : optsA);
  return `${a}\u2013${b}`;
}
function lastNWeekKeys(n) {
  const thisWeek = startOfWeek(new Date());
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(toKey(addDays(thisWeek, -7 * i)));
  return out;
}
function previousWeekKey(key) {
  return toKey(addDays(new Date(key), -7));
}
function shortWeekLabel(key) {
  return new Date(key).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// life score = average progress across categories that logged an entry that week
function computeLifeScoreSeries(categories, entries) {
  const allWeeks = new Set();
  categories.forEach((c) => (entries[c.id] || []).forEach((e) => allWeeks.add(e.weekKey)));
  const weeks = Array.from(allWeeks).sort();
  return weeks.map((wk) => {
    const vals = [];
    categories.forEach((c) => {
      const e = (entries[c.id] || []).find((x) => x.weekKey === wk);
      if (e) vals.push(e.progress);
    });
    return { weekKey: wk, score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) };
  });
}

// generic all-time high/low finder over a [{weekKey, score}] series
function computeAllTimeHighLow(series) {
  if (!series.length) return null;
  let high = series[0];
  let low = series[0];
  series.forEach((p) => {
    if (p.score > high.score) high = p;
    if (p.score < low.score) low = p;
  });
  return { high, low };
}

// ---------- data layer (Supabase) ----------
async function fetchAll(userId) {
  const [{ data: cats, error: catErr }, { data: ents, error: entErr }] = await Promise.all([
    supabase.from("categories").select("*").eq("user_id", userId).order("created_at"),
    supabase.from("entries").select("*").eq("user_id", userId),
  ]);
  if (catErr || entErr) throw catErr || entErr;
  const categories = (cats || []).map((c) => ({
    id: c.id, name: c.name, goal: c.goal || "", icon: c.icon, color: c.color, createdAt: c.created_at,
  }));
  const entries = {};
  (ents || []).forEach((e) => {
    if (!entries[e.category_id]) entries[e.category_id] = [];
    entries[e.category_id].push({ weekKey: e.week_key, progress: e.progress, note: e.note || "", loggedAt: e.logged_at });
  });
  return { categories, entries };
}

async function insertCategoryRemote(userId, cat) {
  const { data, error } = await supabase
    .from("categories")
    .insert({ user_id: userId, name: cat.name, goal: cat.goal, icon: cat.icon, color: cat.color })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, name: data.name, goal: data.goal || "", icon: data.icon, color: data.color, createdAt: data.created_at };
}

async function updateCategoryRemote(cat) {
  const { error } = await supabase
    .from("categories")
    .update({ name: cat.name, goal: cat.goal, icon: cat.icon, color: cat.color })
    .eq("id", cat.id);
  if (error) throw error;
  return cat;
}

async function deleteCategoryRemote(id) {
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

async function upsertEntryRemote(userId, categoryId, weekKey, progress, note) {
  const { data, error } = await supabase
    .from("entries")
    .upsert(
      { user_id: userId, category_id: categoryId, week_key: weekKey, progress, note },
      { onConflict: "category_id,week_key" }
    )
    .select()
    .single();
  if (error) throw error;
  return { weekKey: data.week_key, progress: data.progress, note: data.note || "", loggedAt: data.logged_at };
}

// ---------- small UI atoms ----------
function IconOf({ name, ...props }) {
  const Cmp = ICONS[name] || Target;
  return <Cmp {...props} />;
}

function GrowthArc({ progress = 0, color = COLORS.sage, size = 84 }) {
  const r = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = -180;
  const endAngle = -180 + 180 * (progress / 100);
  const toXY = (angleDeg) => {
    const a = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arcPath = (a0, a1) => {
    const [x0, y0] = toXY(a0);
    const [x1, y1] = toXY(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return (
    <svg width={size} height={size / 2 + 14} viewBox={`0 0 ${size} ${size / 2 + 14}`}>
      <path d={arcPath(-180, 0)} fill="none" stroke={HAIRLINE} strokeWidth="8" strokeLinecap="round" />
      {progress > 0 && (
        <path d={arcPath(startAngle, endAngle)} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      )}
      <text x={cx} y={size / 2 + 10} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="15" fontWeight="500" fill={INK}>
        {progress}%
      </text>
    </svg>
  );
}

function GrowthTrail({ weekKeys, entryMap, color }) {
  return (
    <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
      {weekKeys.map((wk) => {
        const e = entryMap[wk];
        const p = e ? e.progress : 0;
        const has = !!e;
        return (
          <div
            key={wk}
            title={wk}
            style={{
              width: 9,
              height: 9,
              borderRadius: 9,
              background: has ? color : "transparent",
              opacity: has ? Math.max(0.25, p / 100) : 1,
              border: has ? "none" : `1.5px solid ${HAIRLINE}`,
            }}
          />
        );
      })}
    </div>
  );
}

function computeStreak(weekKeys, entryMap) {
  let streak = 0;
  for (let i = weekKeys.length - 1; i >= 0; i--) {
    if (entryMap[weekKeys[i]]) streak++;
    else break;
  }
  return streak;
}

// ---------- auth ----------
function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div style={{ padding: "60px 24px", textAlign: "center" }}>
      <div style={{
        width: 52, height: 52, borderRadius: 14, margin: "0 auto 18px",
        background: `${COLORS.sage}1A`, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Sprout size={24} color={COLORS.sage} />
      </div>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, margin: "0 0 8px" }}>
        Your growth rings
      </h1>
      <p style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.5, margin: "0 0 24px" }}>
        Enter your email and we'll send you a private link to sign in — no password needed.
      </p>

      {sent ? (
        <div style={{
          background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 14,
          padding: "18px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        }}>
          <Mail size={20} color={COLORS.sage} />
          <div style={{ fontWeight: 600, fontSize: 14 }}>Check your inbox</div>
          <div style={{ fontSize: 13, color: INK_SOFT }}>We sent a sign-in link to {email}</div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{
              width: "100%", border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: "12px 14px",
              fontSize: 15, fontFamily: "Inter, sans-serif", background: PAPER_RAISED, textAlign: "center",
            }}
          />
          {error && <div style={{ color: COLORS.clay, fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
          <button
            type="submit"
            disabled={sending}
            style={{
              background: INK, color: PAPER, border: "none", borderRadius: 12,
              padding: "13px 0", fontWeight: 600, fontSize: 14.5, opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? "Sending\u2026" : "Send sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}

function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <Shell>
        <div style={{ padding: 40, textAlign: "center", color: INK_SOFT, fontFamily: "Inter, sans-serif" }}>
          Loading…
        </div>
      </Shell>
    );
  }
  if (!session) {
    return <Shell><LoginScreen /></Shell>;
  }
  return children(session.user);// ---------- main app ----------
export default function App() {
  return <AuthGate>{(user) => <TrackerApp user={user} />}</AuthGate>;
}

function TrackerApp({ user }) {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState({});
  const [view, setView] = useState("dashboard"); // dashboard | detail | form
  const [activeId, setActiveId] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null); // category object or null (new)
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAll(user.id)
      .then(({ categories, entries }) => {
        if (cancelled) return;
        setCategories(categories);
        setEntries(entries);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        showToast("Couldn't load your data \u2014 please refresh");
      });
    return () => { cancelled = true; };
  }, [user.id, showToast]);

  const thisWeekStart = startOfWeek(new Date());
  const thisWeekKey = toKey(thisWeekStart);
  const trailKeys = lastNWeekKeys(8);

  async function upsertCategory(cat) {
    try {
      if (cat.id) {
        const saved = await updateCategoryRemote(cat);
        setCategories((prev) => prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)));
        return saved;
      } else {
        const saved = await insertCategoryRemote(user.id, cat);
        setCategories((prev) => [...prev, saved]);
        return saved;
      }
    } catch (e) {
      showToast("Couldn't save \u2014 please try again");
      return null;
    }
  }

  async function deleteCategory(id) {
    try {
      await deleteCategoryRemote(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setEntries((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setView("dashboard");
    } catch (e) {
      showToast("Couldn't delete \u2014 please try again");
    }
  }

  async function logEntry(categoryId, progress, note) {
    try {
      const record = await upsertEntryRemote(user.id, categoryId, thisWeekKey, progress, note);
      setEntries((prev) => {
        const list = prev[categoryId] ? prev[categoryId].slice() : [];
        const idx = list.findIndex((e) => e.weekKey === thisWeekKey);
        if (idx >= 0) list[idx] = record;
        else list.push(record);
        return { ...prev, [categoryId]: list };
      });
    } catch (e) {
      showToast("Couldn't save \u2014 please try again");
    }
  }

  if (loading) {
    return (
      <Shell>
        <div style={{ padding: 40, textAlign: "center", color: INK_SOFT, fontFamily: "Inter, sans-serif" }}>
          Loading your goals…
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {toast && (
        <div style={{
          position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)",
          background: INK, color: PAPER, padding: "8px 16px", borderRadius: 999,
          fontSize: 13, fontFamily: "Inter, sans-serif", zIndex: 50,
        }}>{toast}</div>
      )}

      {view === "dashboard" && (
        <Dashboard
          categories={categories}
          entries={entries}
          thisWeekKey={thisWeekKey}
          trailKeys={trailKeys}
          onOpen={(id) => { setActiveId(id); setView("detail"); }}
          onAdd={() => { setEditingCategory(null); setView("form"); }}
          onTrends={() => setView("trends")}
          onInsights={() => setView("insights")}
          onSignOut={() => supabase.auth.signOut()}
        />
      )}

      {view === "trends" && (
        <TrendsView
          categories={categories}
          entries={entries}
          thisWeekKey={thisWeekKey}
          onBack={() => setView("dashboard")}
        />
      )}

      {view === "insights" && (
        <LifeScoreView
          categories={categories}
          entries={entries}
          thisWeekKey={thisWeekKey}
          onBack={() => setView("dashboard")}
        />
      )}

      {view === "detail" && activeId && (
        <CategoryDetail
          category={categories.find((c) => c.id === activeId)}
          entryList={(entries[activeId] || []).slice().sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1))}
          thisWeekKey={thisWeekKey}
          onBack={() => setView("dashboard")}
          onEdit={(cat) => { setEditingCategory(cat); setView("form"); }}
          onDelete={() => deleteCategory(activeId)}
          onLog={(progress, note) => logEntry(activeId, progress, note)}
        />
      )}

      {view === "form" && (
        <CategoryForm
          initial={editingCategory}
          existingNames={categories.map((c) => c.name.toLowerCase())}
          onCancel={() => setView(editingCategory ? "detail" : "dashboard")}
          onSave={async (cat) => {
            const saved = await upsertCategory(cat);
            if (saved) {
              setActiveId(saved.id);
              setView("detail");
            }
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div style={{
      minHeight: "100vh", background: PAPER, color: INK,
      fontFamily: "Inter, sans-serif", maxWidth: 480, margin: "0 auto",
      paddingBottom: 40, position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input:focus, textarea:focus, button:focus-visible { outline: 2px solid ${COLORS.teal}; outline-offset: 2px; }
        button { font-family: inherit; cursor: pointer; }
        ::-webkit-scrollbar { display: none; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>
      {children}
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ categories, entries, thisWeekKey, trailKeys, onOpen, onAdd, onTrends, onInsights, onSignOut }) {
  const today = new Date();
  return (
    <div style={{ padding: "28px 20px 12px" }}>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: INK_SOFT, fontWeight: 600 }}>
            Week of {weekLabel(startOfWeek(today))}
          </div>
          <h1 style={{
            fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 30, margin: "4px 0 0",
            letterSpacing: -0.3,
          }}>
            Your growth rings
          </h1>
        </div>
        <button
          onClick={onSignOut}
          title="Sign out"
          style={{
            background: "none", border: "none", color: INK_SOFT, padding: 6, flexShrink: 0, marginTop: 4,
          }}
        >
          <LogOut size={17} />
        </button>
      </div>

      {categories.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          <button
            onClick={onTrends}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: PAPER_RAISED,
              border: `1px solid ${HAIRLINE}`, borderRadius: 11, padding: "9px 12px",
              color: INK, fontSize: 12.5, fontWeight: 600,
            }}
          >
            <TrendingUp size={15} color={COLORS.teal} /> Trends
          </button>
          <button
            onClick={onInsights}
            style={{
              display: "flex", alignItems: "center", gap: 6, background: PAPER_RAISED,
              border: `1px solid ${HAIRLINE}`, borderRadius: 11, padding: "9px 12px",
              color: INK, fontSize: 12.5, fontWeight: 600,
            }}
          >
            <Award size={15} color={COLORS.ochre} /> Life score
          </button>
        </div>
      )}

      {categories.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {categories.map((c) => {
            const entryMap = {};
            (entries[c.id] || []).forEach((e) => (entryMap[e.weekKey] = e));
            const thisEntry = entryMap[thisWeekKey];
            const streak = computeStreak(trailKeys, entryMap);
            return (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 14, textAlign: "left",
                  background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 16,
                  padding: "14px 16px", width: "100%",
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: `${c.color}1A`, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <IconOf name={c.icon} size={21} color={c.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 15.5, marginBottom: 2 }}>{c.name}</div>
                  <div style={{
                    fontSize: 12.5, color: INK_SOFT, whiteSpace: "nowrap", overflow: "hidden",
                    textOverflow: "ellipsis", marginBottom: 6,
                  }}>
                    {c.goal || "No goal set yet"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <GrowthTrail weekKeys={trailKeys} entryMap={entryMap} color={c.color} />
                    {streak > 1 && (
                      <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, color: c.color, fontWeight: 600 }}>
                        <Flame size={12} /> {streak}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: "center" }}>
                  {thisEntry ? (
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 500, color: c.color }}>
                      {thisEntry.progress}%
                    </div>
                  ) : (
                    <div style={{
                      fontSize: 10.5, color: INK_SOFT, border: `1px dashed ${HAIRLINE}`,
                      borderRadius: 8, padding: "5px 8px", fontWeight: 600,
                    }}>
                      LOG WEEK
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          <button
            onClick={onAdd}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: "transparent", border: `1.5px dashed ${HAIRLINE}`, borderRadius: 16,
              padding: "14px 16px", color: INK_SOFT, fontWeight: 600, fontSize: 14, marginTop: 4,
            }}
          >
            <Plus size={16} /> Add a life category
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAdd }) {
  return (
    <div style={{
      border: `1px solid ${HAIRLINE}`, borderRadius: 18, padding: "32px 22px",
      background: PAPER_RAISED, textAlign: "center",
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 14, margin: "0 auto 14px",
        background: `${COLORS.sage}1A`, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Sprout size={24} color={COLORS.sage} />
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, marginBottom: 6 }}>
        Nothing planted yet
      </div>
      <p style={{ fontSize: 13.5, color: INK_SOFT, lineHeight: 1.5, margin: "0 0 18px" }}>
        Choose the areas of life you'd like to grow — health, career, relationships, or anything else that matters to you — and log a little progress each week.
      </p>
      <button
        onClick={onAdd}
        style={{
          background: INK, color: PAPER, border: "none", borderRadius: 12,
          padding: "11px 20px", fontWeight: 600, fontSize: 14, display: "inline-flex",
          alignItems: "center", gap: 6,
        }}
      >
        <Plus size={16} /> Add your first category
      </button>
    </div>
  );
            }// ---------- Category detail ----------
function CategoryDetail({ category, entryList, thisWeekKey, onBack, onEdit, onDelete, onLog }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const existing = entryList.find((e) => e.weekKey === thisWeekKey);
  const [progress, setProgress] = useState(existing ? existing.progress : 50);
  const [note, setNote] = useState(existing ? existing.note : "");
  const [saved, setSaved] = useState(false);

  if (!category) return null;
  const c = category;
  const highLow = entryList.length
    ? computeAllTimeHighLow(entryList.map((e) => ({ weekKey: e.weekKey, score: e.progress })))
    : null;

  function handleSave() {
    onLog(progress, note);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", display: "flex", alignItems: "center", color: INK_SOFT, fontSize: 14, fontWeight: 600, padding: 0 }}>
          <ChevronLeft size={18} /> Back
        </button>
        <div style={{ display: "flex", gap: 14 }}>
          <button onClick={() => onEdit(c)} style={{ background: "none", border: "none", color: INK_SOFT, padding: 0 }}>
            <Pencil size={17} />
          </button>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: INK_SOFT }}>Delete?</span>
              <button onClick={onDelete} style={{ background: "none", border: "none", color: COLORS.clay, padding: 0 }}><Check size={17} /></button>
              <button onClick={() => setConfirmDelete(false)} style={{ background: "none", border: "none", color: INK_SOFT, padding: 0 }}><X size={17} /></button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", color: INK_SOFT, padding: 0 }}>
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, background: `${c.color}1A`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <IconOf name={c.icon} size={19} color={c.color} />
        </div>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, margin: 0 }}>{c.name}</h1>
      </div>
      {c.goal && <p style={{ fontSize: 14, color: INK_SOFT, margin: "6px 0 16px", lineHeight: 1.5 }}>{c.goal}</p>}

      {highLow && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <div style={{
            flex: 1, background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 12,
            padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 4 }}>
              <ArrowUp size={11} color={COLORS.sage} /> All-time high
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 500, color: COLORS.sage }}>
              {highLow.high.score}%
            </div>
            <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 1 }}>{weekLabel(new Date(highLow.high.weekKey))}</div>
          </div>
          <div style={{
            flex: 1, background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 12,
            padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 4 }}>
              <ArrowDown size={11} color={COLORS.clay} /> All-time low
            </div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 500, color: COLORS.clay }}>
              {highLow.low.score}%
            </div>
            <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 1 }}>{weekLabel(new Date(highLow.low.weekKey))}</div>
          </div>
        </div>
      )}

      <div style={{
        background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 18,
        padding: "20px 18px", marginBottom: 20,
      }}>
        <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 14 }}>
          This week {existing ? "\u2014 logged" : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <GrowthArc progress={progress} color={c.color} size={120} />
        </div>
        <input
          type="range" min="0" max="100" step="5" value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
          style={{ width: "100%", accentColor: c.color, marginBottom: 16 }}
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything you'd like to remember about this week?"
          rows={3}
          style={{
            width: "100%", border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: 10,
            fontFamily: "Inter, sans-serif", fontSize: 13.5, resize: "none", background: PAPER,
          }}
        />
        <button
          onClick={handleSave}
          style={{
            marginTop: 12, width: "100%", background: saved ? COLORS.sage : INK, color: PAPER,
            border: "none", borderRadius: 12, padding: "12px 0", fontWeight: 600, fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {saved ? (<><Check size={16} /> Saved</>) : existing ? "Update this week" : "Log this week"}
        </button>
      </div>

      <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 10 }}>
        History
      </div>
      {entryList.length === 0 ? (
        <p style={{ fontSize: 13.5, color: INK_SOFT }}>No weeks logged yet — this is a good place to begin.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entryList.map((e) => (
            <div key={e.weekKey} style={{
              display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px",
              background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 12,
            }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 500, color: c.color, minWidth: 40 }}>
                {e.progress}%
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: INK_SOFT, marginBottom: e.note ? 3 : 0 }}>
                  {weekLabel(new Date(e.weekKey))}
                </div>
                {e.note && <div style={{ fontSize: 13, lineHeight: 1.4 }}>{e.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Add / edit category form ----------
function CategoryForm({ initial, existingNames, onCancel, onSave }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [goal, setGoal] = useState(initial?.goal || "");
  const [icon, setIcon] = useState(initial?.icon || ICON_NAMES[0]);
  const [color, setColor] = useState(initial?.color || COLOR_LIST[0]);
  const [error, setError] = useState("");

  const availableSuggestions = SUGGESTIONS.filter(
    (s) => !existingNames.includes(s.name.toLowerCase()) || (isEdit && initial.name === s.name)
  );

  function applySuggestion(s) {
    setName(s.name);
    setIcon(s.icon);
    setColor(s.color);
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Please give this category a name"); return; }
    const dup = existingNames.includes(trimmed.toLowerCase()) && (!isEdit || initial.name.toLowerCase() !== trimmed.toLowerCase());
    if (dup) { setError("You already have a category with that name"); return; }
    onSave({
      id: initial?.id,
      name: trimmed,
      goal: goal.trim(),
      icon, color,
    });
  }

  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <button onClick={onCancel} style={{ background: "none", border: "none", display: "flex", alignItems: "center", color: INK_SOFT, fontSize: 14, fontWeight: 600, padding: 0 }}>
          <ChevronLeft size={18} /> Cancel
        </button>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: 0 }}>
          {isEdit ? "Edit category" : "New category"}
        </h1>
        <div style={{ width: 60 }} />
      </div>

      {!isEdit && availableSuggestions.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 10 }}>
            Suggestions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {availableSuggestions.map((s) => (
              <button
                key={s.name}
                onClick={() => applySuggestion(s)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "7px 12px",
                  borderRadius: 999, border: `1px solid ${name === s.name ? s.color : HAIRLINE}`,
                  background: name === s.name ? `${s.color}1A` : PAPER_RAISED, fontSize: 12.5, fontWeight: 600,
                  color: name === s.name ? s.color : INK,
                }}
              >
                <IconOf name={s.icon} size={13} /> {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT }}>
        Name
      </label>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setError(""); }}
        placeholder="e.g. Health & Vitality"
        style={{
          width: "100%", border: `1px solid ${HAIRLINE}`, borderRadius: 10, padding: "10px 12px",
          fontSize: 15, margin: "8px 0 18px", fontFamily: "Inter, sans-serif",function TrendsView({ categories, entries, thisWeekKey, onBack }) {
  const weekKeys = lastNWeekKeys(10);
  const prevWeekKey = previousWeekKey(thisWeekKey);
  const nameById = {};
  categories.forEach((c) => (nameById[c.id] = c.name));

  const chartData = weekKeys.map((wk) => {
    const point = { week: shortWeekLabel(wk) };
    const vals = [];
    categories.forEach((c) => {
      const e = (entries[c.id] || []).find((x) => x.weekKey === wk);
      point[c.id] = e ? e.progress : null;
      if (e) vals.push(e.progress);
    });
    point.average = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    return point;
  });

  // momentum: average delta across categories with both this-week and prior-week entries
  const deltas = categories
    .map((c) => {
      const list = entries[c.id] || [];
      const cur = list.find((e) => e.weekKey === thisWeekKey);
      const prev = list.find((e) => e.weekKey === prevWeekKey);
      if (cur && prev) return cur.progress - prev.progress;
      return null;
    })
    .filter((d) => d !== null);
  const momentum = deltas.length ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null;

  const hasAnyData = chartData.some((p) => p.average !== null);

  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", display: "flex", alignItems: "center", color: INK_SOFT, fontSize: 14, fontWeight: 600, padding: 0 }}>
          <ChevronLeft size={18} /> Back
        </button>
      </div>

      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, margin: "0 0 4px" }}>
        Week over week
      </h1>
      <p style={{ fontSize: 13.5, color: INK_SOFT, margin: "0 0 20px" }}>
        Your last {weekKeys.length} weeks, across every category
      </p>

      <div style={{
        background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 16,
        padding: "16px 14px 6px", marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 4px 12px" }}>
          <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT }}>
            Overall momentum
          </div>
          {momentum === null ? (
       r: INK_SOFT }}>Not enough data yet</span>
          ) : (
            <span style={{
              display: "flex", alignItems: "center", gap: 4, fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 500, fontSize: 14, color: momentum > 0 ? COLORS.sage : momentum < 0 ? COLORS.clay : INK_SOFT,
            }}>
              {momentum > 0 ? <ArrowUp size={14} /> : momentum < 0 ? <ArrowDown size={14} /> : <Minus size={14} />}
              {momentum > 0 ? "+" : ""}{momentum}% vs last week
            </span>
          )}
        </div>

        {hasAnyData ? (
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={HAIRLINE} vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10.5, fill: INK_SOFT, fontFamily: "Inter, sans-serif" }} axisLine={{ stroke: HAIRLINE }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10.5, fill: INK_SOFT, fontFamily: "Inter, sans-serif" }} axisLine={false} tickLine={false} width={34} />
                <Tooltip content={<CustomTooltip nameById={nameById} />} />
                {categories.map((c) => (
                  <Line
                    key={c.id}
                    type="monotone"
                    dataKey={c.id}
                    stroke={c.color}
                    strokeWidth={1.75}
                    dot={{ r: 2.5, strokeWidth: 0, fill: c.color }}
                    connectNulls
                    opacity={0.85}
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="average"
                  stroke={INK}
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: INK }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ padding: "30px 4px 20px", textAlign: "center", fontSize: 13, color: INK_SOFT }}>
            Log a few weeks to see your trend line take shape.
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "10px 4px 14px", borderTop: `1px solid ${HAIRLINE}`, marginTop: 4 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: INK_SOFT, fontWeight: 600 }}>
            <span style={{ width: 14, height: 2, background: INK, display: "inline-block" }} /> Average
          </span>
          {categories.map((c) => (
            <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: INK_SOFT, fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: c.color, display: "inline-block" }} /> {c.name}
            </span>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 10 }}>
        By category
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((c) => {
          const list = entries[c.id] || [];
          const cur = list.find((e) => e.weekKey === thisWeekKey);
          const prev = list.find((e) => e.weekKey === prevWeekKey);
          const entryMap = {};
          list.forEach((e) => (entryMap[e.weekKey] = e));
          let badge;
          if (cur && prev) {
            const delta = cur.progress - prev.progress;
            const dColor = delta > 0 ? COLORS.sage : delta < 0 ? COLORS.clay : INK_SOFT;
            badge = (
              <span style={{ display: "flex", alignItems: "center", gap: 3, color: dColor, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500, fontSize: 13 }}>
                {delta > 0 ? <ArrowUp size={13} /> : delta < 0 ? <ArrowDown size={13} /> : <Minus size={13} />}
                {delta > 0 ? "+" : ""}{delta}%
              </span>
            );
          } else if (cur && !prev) {
            badge = <span style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 600 }}>No prior week</span>;
          } else {
            badge = <span style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 600 }}>Not logged</span>;
          }
          return (
            <div key={c.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 14,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: `${c.color}1A`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <IconOf name={c.icon} size={16} color={c.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{c.name}</div>
                <GrowthTrail weekKeys={weekKeys.slice(-8)} entryMap={entryMap} color={c.color} />
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>{badge}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Life score dashboard ----------
function LifeScoreView({ categories, entries, thisWeekKey, onBack }) {
  const series = computeLifeScoreSeries(categories, entries);
  const highLow = computeAllTimeHighLow(series);
  const prevWeekKey = previousWeekKey(thisWeekKey);

  const thisWeekPoint = series.find((p) => p.weekKey === thisWeekKey);
  const lastWeekPoint = series.find((p) => p.weekKey === prevWeekKey);
  const progressScore = thisWeekPoint && lastWeekPoint ? thisWeekPoint.score - lastWeekPoint.score : null;

  const chartSeries = series.slice(-12);
  const chartData = chartSeries.map((p) => ({ week: shortWeekLabel(p.weekKey), score: p.score, weekKey: p.weekKey }));
  const highInView = highLow && chartSeries.some((p) => p.weekKey === highLow.high.weekKey);
  const lowInView = highLow && chartSeries.some((p) => p.weekKey === highLow.low.weekKey);

  return (
    <div style={{ padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", display: "flex", alignItems: "center", color: INK_SOFT, fontSize: 14, fontWeight: 600, padding: 0 }}>
          <ChevronLeft size={18} /> Back
        </button>
      </div>

      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, margin: "0 0 4px" }}>
        Life score
      </h1>
      <p style={{ fontSize: 13.5, color: INK_SOFT, margin: "0 0 20px" }}>
        Your average progress across every category, tracked week by week
      </p><div style={{
        background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 18,
        padding: "20px 18px", marginBottom: 16, textAlign: "center",
      }}>
        <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 8 }}>
          This week's life score
        </div>
        {thisWeekPoint ? (
          <>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 48, fontWeight: 600, lineHeight: 1, color: INK }}>
              {thisWeekPoint.score}
            </div>
            <div style={{ marginTop: 8 }}>
              {progressScore === null ? (
                <span style={{ fontSize: 12.5, color: INK_SOFT }}>No prior week to compare</span>
              ) : (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "'IBM Plex Mono', monospace",
                  fontWeight: 500, fontSize: 14, color: progressScore > 0 ? COLORS.sage : progressScore < 0 ? COLORS.clay : INK_SOFT,
                }}>
                  {progressScore > 0 ? <ArrowUp size={14} /> : progressScore < 0 ? <ArrowDown size={14} /> : <Minus size={14} />}
                  {progressScore > 0 ? "+" : ""}{progressScore} pts vs last week
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13.5, color: INK_SOFT, padding: "8px 0 4px" }}>
            You haven't logged any categories yet this week
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <div style={{ flex: 1, background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 5 }}>
            <ArrowUp size={11} color={COLORS.sage} /> All-time high
          </div>
          {highLow ? (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 500, color: COLORS.sage }}>
                {highLow.high.score}
              </div>
              <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 1 }}>{weekLabel(new Date(highLow.high.weekKey))}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: INK_SOFT }}>{"—"}</div>
          )}
        </div>
        <div style={{ flex: 1, background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 14, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 5 }}>
            <ArrowDown size={11} color={COLORS.clay} /> All-time low
          </div>
          {highLow ? (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 500, color: COLORS.clay }}>
                {highLow.low.score}
              </div>
              <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 1 }}>{weekLabel(new Date(highLow.low.weekKey))}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: INK_SOFT }}>{"—"}</div>
          )}
        </div>
      </div>

      {chartData.length > 1 && (
        <div style={{
          background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 16,
          padding: "16px 10px 8px", marginBottom: 22,
        }}>
          <div style={{ width: "100%", height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={HAIRLINE} vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10.5, fill: INK_SOFT, fontFamily: "Inter, sans-serif" }} axisLine={{ stroke: HAIRLINE }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10.5, fill: INK_SOFT, fontFamily: "Inter, sans-serif" }} axisLine={false} tickLine={false} width={34} />
                <Tooltip content={({ active, payload, label }) => {
                  if (!active || !payload || !payload.length) return null;
                  return (
                    <div style={{ background: INK, color: PAPER, borderRadius: 10, padding: "8px 11px", fontSize: 12, fontFamily: "Inter, sans-serif" }}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{payload[0].value} pts</div>
                    </div>
                  );
                }} />
                <Line type="monotone" dataKey="score" stroke={COLORS.ochre} strokeWidth={2.5} dot={{ r: 3, strokeWidth: 0, fill: COLORS.ochre }} />
                {highInView && (
                  <ReferenceDot x={shortWeekLabel(highLow.high.weekKey)} y={highLow.high.score} r={5} fill={COLORS.sage} stroke={PAPER_RAISED} strokeWidth={2} />
                )}
                {lowInView && (
                  <ReferenceDot x={shortWeekLabel(highLow.low.weekKey)} y={highLow.low.score} r={5} fill={COLORS.clay} stroke={PAPER_RAISED} strokeWidth={2} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", fontWeight: 600, color: INK_SOFT, marginBottom: 10 }}>
        Category records
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {categories.map((c) => {
          const list = entries[c.id] || [];
          const hl = list.length ? computeAllTimeHighLow(list.map((e) => ({ weekKey: e.weekKey, score: e.progress }))) : null;
          return (
            <div key={c.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              background: PAPER_RAISED, border: `1px solid ${HAIRLINE}`, borderRadius: 14,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: `${c.color}1A`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <IconOf name={c.icon} size={16} color={c.color} />
              </div>
              <div style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14 }}>{c.name}</div>
              {hl ? (
                <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: COLORS.sage }}>{hl.high.score}%</div>
                    <div style={{ fontSize: 9.5, color: INK_SOFT, fontWeight: 600, letterSpacing: 0.3 }}>HIGH</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: COLORS.clay }}>{hl.low.score}%</div>
                    <div style={{ fontSize: 9.5, color: INK_SOFT, fontWeight: 600, letterSpacing: 0.3 }}>LOW</div>
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: 11.5, color: INK_SOFT, fontWeight: 600, flexShrink: 0 }}>No entries yet</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
                    }
