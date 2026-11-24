import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/auth-card";
import { OrgRedirect } from "@/components/org-redirect";
import { SiteHeader } from "@/components/site-header";
import { hasSession } from "@/lib/session";

/** Signed out: the public product page. Signed in: straight to the last-used organization. */
export default async function Home() {
  if (await hasSession()) return <OrgRedirect />;
  return <Landing />;
}

// ------------------------------------------------------------------ content

const STEPS = [
  ["Design your dataset with us", "Our evaluation experts help you build focused datasets and the right variants to test. Every version is locked, so each run can be repeated exactly."],
  ["Run against your app", "A small client package fetches tasks, calls your app in your own environment and sends the outputs back."],
  ["Compare the results", "Watch runs live and compare variants side by side: outputs, errors, latency, tokens and cost. We help you turn them into a clear decision."],
];

const EXPERTISE: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Datasets that find real problems",
    body: "We help you choose test cases that reflect your real traffic, edge cases and known failure modes, not just the easy path.",
    icon: <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7" />,
  },
  {
    title: "Variants worth comparing",
    body: "We help you decide which models, prompts and settings to put side by side, so every run answers a real question.",
    icon: <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />,
  },
  {
    title: "A report you can act on",
    body: "We go through the results with you and turn them into a clear recommendation on quality, speed and cost.",
    icon: <path d="M9 12l2 2 4-4M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />,
  },
];

const FEATURES: { title: string; body: string; tone: string; icon: ReactNode }[] = [
  {
    title: "Your code stays with you",
    body: "Reval never hosts your app. Model keys, databases and internal services stay in your environment.",
    tone: "from-brand-500 to-violet-500 shadow-brand-500/30",
    icon: <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />,
  },
  {
    title: "Fair variant comparisons",
    body: "Compare models, prompts or settings in one run. Each item's variants run at the same moment, so load spikes hit them all equally.",
    tone: "from-fuchsia-500 to-pink-500 shadow-fuchsia-500/30",
    icon: <path d="M4 19V9m6 10V5m6 14v-7m4 7H2" />,
  },
  {
    title: "Expected answers never leave",
    body: "Clients only ever receive inputs. Expected answers stay on the server.",
    tone: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
    icon: <path d="M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z" />,
  },
  {
    title: "Tokens, cost and latency",
    body: "Report usage from your app and Reval totals it per variant, so quality and spend are on the same page.",
    tone: "from-amber-500 to-orange-500 shadow-amber-500/30",
    icon: <path d="M12 3v18M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H6" />,
  },
  {
    title: "Robust by default",
    body: "Repeats, timeouts, retries and concurrency are managed by Reval. If a machine dies, its tasks are handed out again.",
    tone: "from-sky-500 to-cyan-500 shadow-sky-500/30",
    icon: <path d="M20 12a8 8 0 11-2.3-5.6M20 4v5h-5" />,
  },
  {
    title: "Every output kept",
    body: "Raw outputs are stored with each run, so you can inspect them and score them later without re-running anything.",
    tone: "from-violet-500 to-indigo-500 shadow-violet-500/30",
    icon: <path d="M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  },
];

// ------------------------------------------------------------------ graphics

/** Abstract neural network: layered nodes joined by faint edges, a few of them "firing". */
function NeuralNet({ className }: { className?: string }) {
  const layers = [4, 6, 7, 6, 4];
  const w = 800, h = 520;
  const nodes = layers.map((count, li) =>
    Array.from({ length: count }, (_, ni) => ({
      x: 60 + (li * (w - 120)) / (layers.length - 1),
      y: h / 2 + (ni - (count - 1) / 2) * 72 + (li % 2 ? 18 : -10),
    })),
  );
  const edges = nodes.slice(1).flatMap((layer, li) =>
    layer.flatMap((b, bi) => nodes[li]!.map((a, ai) => ({ a, b, hot: (ai * 3 + bi * 5 + li) % 9 === 0 }))),
  );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} fill="none" aria-hidden>
      <defs>
        <linearGradient id="nn-edge" x1="0" x2="1">
          <stop offset="0" stopColor="#818cf8" />
          <stop offset="0.5" stopColor="#c084fc" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
        <radialGradient id="nn-node">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.4" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#c4b5fd" stopOpacity="0" />
        </radialGradient>
      </defs>
      {edges.map(({ a, b, hot }, i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke="url(#nn-edge)" strokeWidth={hot ? 1.6 : 0.6} strokeOpacity={hot ? 0.9 : 0.22}
          strokeDasharray={hot ? "6 14" : undefined}
          className={hot ? "motion-safe:animate-dash" : undefined} />
      ))}
      {nodes.flat().map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="14" fill="url(#nn-node)"
            className="motion-safe:animate-glow" style={{ animationDelay: `${(i * 0.37) % 5}s` }} />
          <circle cx={n.x} cy={n.y} r="3.5" fill="#fff" />
        </g>
      ))}
    </svg>
  );
}

/** Mock results card: two variants compared, as the portal shows them. */
function ResultsCard() {
  const rows = [
    { name: "gpt-4o-mini", done: 100, latency: "0.8s", cost: "$0.012", color: "from-brand-500 to-violet-500" },
    { name: "claude-haiku", done: 97, latency: "0.7s", cost: "$0.015", color: "from-fuchsia-500 to-pink-500" },
  ];
  return (
    <div className="w-72 rounded-xl bg-white/95 p-4 shadow-2xl shadow-brand-900/40 ring-1 ring-white/50 backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-900">Run #128 · faq-questions</p>
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          <span className="size-1.5 rounded-full bg-emerald-500" /> completed
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-mono font-medium text-zinc-700">{r.name}</span>
              <span className="text-zinc-500">{r.done}% ok · {r.latency} · {r.cost}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-zinc-100">
              <div className={`h-2 rounded-full bg-gradient-to-r ${r.color}`} style={{ width: `${r.done}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-zinc-400">240 tasks · 2 variants · 3 repeats</p>
    </div>
  );
}

function CodeWindow() {
  const kw = "text-fuchsia-400", fn = "text-sky-300", str = "text-emerald-300", cm = "text-zinc-500";
  return (
    <div className="overflow-hidden rounded-xl bg-zinc-950/80 shadow-2xl shadow-black/40 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-rose-400/80" />
        <span className="size-2.5 rounded-full bg-amber-400/80" />
        <span className="size-2.5 rounded-full bg-emerald-400/80" />
        <span className="ml-3 font-mono text-xs text-zinc-500">eval.py</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-zinc-200"><code>
        <span className={kw}>from</span> reval <span className={kw}>import</span> run_eval{"\n\n"}
        <span className={kw}>def</span> <span className={fn}>solver</span>(input, config):{"\n"}
        {"    "}<span className={cm}># Call your app exactly as it runs today</span>{"\n"}
        {"    "}<span className={kw}>return</span> my_app.solve(input[<span className={str}>&quot;question&quot;</span>],{"\n"}
        {"                        "}model=config[<span className={str}>&quot;model&quot;</span>]){"\n\n"}
        run = <span className={fn}>run_eval</span>(<span className={str}>&quot;support-bot&quot;</span>, <span className={str}>&quot;faq-questions&quot;</span>, solver){"\n"}
        <span className={fn}>print</span>(run.url)
      </code></pre>
    </div>
  );
}

// ------------------------------------------------------------------ page

function Landing() {
  return (
    <>
      <SiteHeader signedIn={false} />
      <main className="overflow-x-clip">
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-[#0b0b1f] text-white">
          {/* glow orbs */}
          <div className="pointer-events-none absolute -top-40 -left-32 -z-10 size-[36rem] rounded-full bg-brand-600/40 blur-3xl motion-safe:animate-float-slow" />
          <div className="pointer-events-none absolute top-20 right-[-10rem] -z-10 size-[32rem] rounded-full bg-fuchsia-600/30 blur-3xl motion-safe:animate-float" />
          <div className="pointer-events-none absolute bottom-[-12rem] left-1/3 -z-10 size-[28rem] rounded-full bg-cyan-500/20 blur-3xl motion-safe:animate-float-slow" />
          {/* dot grid */}
          <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.15] [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          {/* network */}
          <NeuralNet className="pointer-events-none absolute top-1/2 right-[-6rem] -z-10 w-[56rem] max-w-none -translate-y-1/2 opacity-50 lg:opacity-70" />

          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-32">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-brand-100 ring-1 ring-white/15 backdrop-blur">
                <span className="size-1.5 rounded-full bg-cyan-400 motion-safe:animate-glow" />
                Evaluation platform + expert guidance
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
                Know how your AI app performs{" "}
                <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                  before your users do.
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-300">
                Reval is more than a tool. Our evaluation experts help you build the right datasets, choose the
                variants to compare and understand the results, while your app keeps running in your own environment.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/register"
                  className="rounded-lg bg-gradient-to-r from-brand-500 to-fuchsia-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:brightness-110">
                  Get started
                </Link>
                <Link href="/docs"
                  className="rounded-lg bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/15">
                  Read the docs →
                </Link>
              </div>
            </div>

            <div className="relative min-w-0 lg:pl-6">
              <CodeWindow />
              <div className="mt-6 flex justify-end sm:absolute sm:-bottom-44 sm:-left-8 sm:mt-0 sm:block motion-safe:animate-float">
                <ResultsCard />
              </div>
            </div>
          </div>
          {/* fade into page */}
          <div className="h-16 bg-gradient-to-b from-transparent to-zinc-50/5" />
        </section>

        {/* How it works */}
        <section className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <p className="text-sm font-semibold text-brand-600">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">From dataset to comparison in three steps</h2>
          <p className="mt-3 max-w-2xl text-zinc-600">No agents to deploy and no code to hand over: add a few lines to a script and run it wherever your app runs, including CI.</p>
          <ol className="relative mt-12 grid gap-6 md:grid-cols-3">
            <div className="pointer-events-none absolute top-10 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-brand-300 via-fuchsia-300 to-cyan-300 md:block" />
            {STEPS.map(([title, body], i) => (
              <li key={title} className="relative rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200 transition hover:-translate-y-1 hover:shadow-lg">
                <span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-fuchsia-500 text-sm font-bold text-white shadow-md shadow-brand-500/30">
                  {i + 1}
                </span>
                <h3 className="mt-5 font-semibold text-zinc-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Expertise */}
        <section className="relative isolate overflow-hidden bg-[#0b0b1f] text-white">
          <div className="pointer-events-none absolute -top-32 left-1/4 -z-10 size-[30rem] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="pointer-events-none absolute -right-24 bottom-[-10rem] -z-10 size-[26rem] rounded-full bg-fuchsia-600/25 blur-3xl" />
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-sm font-semibold text-cyan-300">Expertise included</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                You don&apos;t just get a tool.{" "}
                <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-cyan-300 bg-clip-text text-transparent">
                  You get an evaluation team.
                </span>
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-300">
                A good evaluation depends on asking the right questions. Our specialists work with you from the first
                dataset to the final report, so you know which variant to ship and why.
              </p>
            </div>
            <ul className="space-y-4">
              {EXPERTISE.map((e) => (
                <li key={e.title} className="flex gap-4 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10 backdrop-blur">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-fuchsia-500 shadow-lg shadow-fuchsia-500/30">
                    <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {e.icon}
                    </svg>
                  </span>
                  <div>
                    <h3 className="font-semibold">{e.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-zinc-300">{e.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Features */}
        <section className="relative isolate overflow-hidden border-y border-zinc-200 bg-white">
          <div className="pointer-events-none absolute -top-24 right-0 -z-10 size-96 rounded-full bg-fuchsia-100 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 -left-24 -z-10 size-96 rounded-full bg-brand-100 blur-3xl" />
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
            <p className="text-sm font-semibold text-fuchsia-600">Why Reval</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">Built for teams shipping AI features</h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="group rounded-2xl bg-white/70 p-6 ring-1 ring-zinc-200 backdrop-blur transition hover:-translate-y-1 hover:shadow-lg">
                  <span className={`grid size-11 place-items-center rounded-xl bg-gradient-to-br shadow-lg ${f.tone}`}>
                    <svg viewBox="0 0 24 24" className="size-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      {f.icon}
                    </svg>
                  </span>
                  <h3 className="mt-5 font-semibold text-zinc-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="relative isolate overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-violet-600 to-fuchsia-600 px-6 py-16 text-center shadow-2xl shadow-brand-600/30 sm:px-12">
            <NeuralNet className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-30" />
            <h2 className="text-3xl font-semibold tracking-tight text-white">Run your first evaluation today</h2>
            <p className="mx-auto mt-3 max-w-xl text-brand-100">Create an organization and our team will help you design your first dataset, choose your variants and read the results.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/register" className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-700 shadow-lg transition hover:bg-brand-50">Get started</Link>
              <Link href="/docs" className="rounded-lg px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/40 transition hover:bg-white/10">Read the docs →</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-zinc-500 sm:px-6">
          <Logo />
          <nav className="flex gap-5">
            <Link href="/docs" className="hover:text-zinc-900">Docs</Link>
            <Link href="/login" className="hover:text-zinc-900">Log in</Link>
            <Link href="/register" className="hover:text-zinc-900">Sign up</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
