"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Badge, Card, Code, CopyButton, cx, PageHeader, Table, Td, Th } from "@/components/ui";
import { useOrg } from "@/lib/hooks";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Until the Python package is on PyPI. Update here when it's published.
const PYTHON_INSTALL = "pip install -e path/to/reval-python    # until it's published on PyPI";

const SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "quick-start", label: "Quick start" },
  { id: "install", label: "Install a client" },
  { id: "datasets", label: "Projects & datasets" },
  { id: "solver", label: "Write a solver" },
  { id: "variants", label: "Comparing variants" },
  { id: "usage", label: "Tokens & cost" },
  { id: "options", label: "Run options" },
  { id: "http", label: "Other languages (HTTP)" },
  { id: "faq", label: "FAQ" },
];

// ------------------------------------------------------------------ building blocks

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-100">
        <code data-lang={lang}>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function CodeTabs({ tabs }: { tabs: { label: string; code: string; badge?: string }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="flex gap-1 border-b border-zinc-200">
        {tabs.map((t, i) => (
          <button key={t.label} type="button" onClick={() => setActive(i)}
            className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
              i === active ? "border-brand-600 text-brand-700" : "border-transparent text-zinc-600 hover:text-zinc-900")}>
            {t.label}
            {t.badge && <Badge tone="amber">{t.badge}</Badge>}
          </button>
        ))}
      </div>
      <div className="mt-3"><CodeBlock code={tabs[active]?.code ?? ""} /></div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <Card title={title}>
        <div className="space-y-4 text-sm leading-relaxed text-zinc-700">{children}</div>
      </Card>
    </section>
  );
}

function Step({ n, title, done, children }: { n: number; title: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold",
        done ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700")}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-zinc-900">{title}</p>
        <div className="mt-1 text-zinc-600">{children}</div>
      </div>
    </li>
  );
}

function KeyTable({ rows, head }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="rounded-md ring-1 ring-zinc-200">
      <Table>
        <thead className="bg-zinc-50"><tr><Th>{head[0]}</Th><Th>{head[1]}</Th></tr></thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map(([k, v], i) => <tr key={i}><Td className="align-top whitespace-nowrap">{k}</Td><Td>{v}</Td></tr>)}
        </tbody>
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ diagram

function Box({ x, y, w, h, title, lines, mono, tone = "plain" }: {
  x: number; y: number; w: number; h: number; title: string; lines: string[]; mono?: string; tone?: "plain" | "brand";
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={8}
        className={tone === "brand" ? "fill-brand-50 stroke-brand-500" : "fill-white stroke-zinc-300"} strokeWidth={1.25} />
      <text x={x + 16} y={y + 26} className="fill-zinc-900 text-[13px] font-semibold">{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={x + 16} y={y + 46 + i * 16} className="fill-zinc-500 text-[11px]">{l}</text>
      ))}
      {mono && <text x={x + 16} y={y + 46 + lines.length * 16 + 6} className="fill-brand-700 font-mono text-[11px]">{mono}</text>}
    </g>
  );
}

function StepBadge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={8} className="fill-brand-600" />
      <text x={x} y={y + 3.5} textAnchor="middle" className="fill-white text-[10px] font-semibold">{n}</text>
    </g>
  );
}

function Flow({ x1, y1, x2, y2, both }: { x1: number; y1: number; x2: number; y2: number; both?: boolean }) {
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-zinc-400" strokeWidth={1.5}
      markerEnd="url(#docs-arrow)" markerStart={both ? "url(#docs-arrow)" : undefined} />
  );
}

function ArchitectureDiagram() {
  const label = "text-[11px] fill-zinc-700 font-medium";
  return (
    <figure className="overflow-x-auto rounded-md bg-zinc-50 p-3 ring-1 ring-zinc-200">
      <svg viewBox="0 0 880 330" className="w-full min-w-[640px]" role="img"
        aria-label="Your eval script, in your environment, starts a run on Reval, leases tasks, calls your app through your solver, and submits outputs. Reval stores them and shows them in the portal.">
        <defs>
          <marker id="docs-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className="fill-zinc-400" />
          </marker>
        </defs>

        {/* Your environment */}
        <rect x={10} y={10} width={350} height={310} rx={12} className="fill-white/60 stroke-zinc-300" strokeDasharray="5 4" />
        <text x={30} y={38} className="fill-zinc-500 text-[11px] font-semibold tracking-wider">YOUR ENVIRONMENT</text>
        <Box x={30} y={56} w={310} h={96} title="Eval script" lines={["Reval client package + your solver()"]} mono="run_eval(project, dataset, solver)" />
        <Box x={30} y={200} w={130} h={80} title="Your app" lines={["endpoint or", "function, unchanged"]} />
        <Box x={190} y={200} w={150} h={80} title="Model provider" lines={["called with your", "own API keys"]} />
        <Flow x1={102} y1={152} x2={102} y2={198} both />
        <StepBadge x={120} y={175} n={3} />
        <text x={134} y={179} className={label}>solver(input, config)</text>
        <Flow x1={162} y1={240} x2={188} y2={240} both />
        <text x={30} y={308} className="fill-emerald-700 text-[11px] font-medium">✓ Code, data access and model keys stay here</text>

        {/* Between */}
        <Flow x1={342} y1={82} x2={518} y2={82} />
        <StepBadge x={366} y={71} n={1} /><text x={380} y={75} className={label}>start run</text>
        <Flow x1={518} y1={108} x2={342} y2={108} />
        <StepBadge x={366} y={97} n={2} /><text x={380} y={101} className={label}>tasks: input + config</text>
        <Flow x1={342} y1={134} x2={518} y2={134} />
        <StepBadge x={366} y={123} n={4} /><text x={380} y={127} className={label}>outputs + usage</text>
        <text x={440} y={170} textAnchor="middle" className="fill-zinc-400 text-[10px]">HTTPS · API key</text>

        {/* Reval */}
        <rect x={520} y={10} width={350} height={310} rx={12} className="fill-white stroke-brand-500" strokeWidth={1.25} />
        <text x={540} y={38} className="fill-brand-700 text-[11px] font-semibold tracking-wider">REVAL</text>
        <Box x={540} y={56} w={310} h={96} tone="brand" title="Reval API" lines={["Hands out tasks and decides repeats,", "timeouts, concurrency and retries"]} />
        <Box x={540} y={200} w={130} h={80} title="Runs & datasets" lines={["inputs, expected,", "outputs, usage"]} />
        <Box x={700} y={200} w={150} h={80} title="Portal" lines={["progress, latency,", "compare variants"]} />
        <Flow x1={612} y1={152} x2={612} y2={198} both />
        <Flow x1={672} y1={240} x2={698} y2={240} />
        <text x={540} y={308} className="fill-emerald-700 text-[11px] font-medium">✓ Expected answers never leave the server</text>
      </svg>
    </figure>
  );
}

// ------------------------------------------------------------------ snippets

const TASK_ITEM = `{
  "id": "q2",
  "input": { "question": "Capital of France?" },
  "expected": "Paris"
}`;

const TASK_RECEIVED = `input  = { "question": "Capital of France?" }
config = { "model": "gpt-4o-mini", "temperature": 0 }
# variant "gpt-4o-mini", repeat 1 of 3`;

const TASK_RESULT = `Output("Paris", metadata={
    "model": "gpt-4o-mini",
    "inputTokens": 42, "outputTokens": 3, "costUsd": 0.0000081,
})
# Reval adds the latency and links it to item q2, variant gpt-4o-mini, repeat 1`;

const PY_QUICK = `from reval import run_eval

# REVAL_API_KEY and REVAL_BASE_URL are read from the environment
def solver(input):
    # \`input\` is the dataset item's input; return your app's answer
    return my_app.solve(input["question"])

run = run_eval("my-project", "my-dataset", solver)
print(run.url)`;

const PY_SOLVER = `from reval import Output, run_eval

def solver(input, config):
    # config is the variant's config, e.g. {"model": "gpt-4o-mini", "temperature": 0}
    reply = my_app.solve(
        input["question"],
        model=config.get("model", "gpt-4o-mini"),
        temperature=config.get("temperature", 0),
    )
    # Your prices per 1M tokens; Reval never knows model prices
    cost = (reply.input_tokens * 0.15 + reply.output_tokens * 0.60) / 1_000_000
    return Output(reply.answer, metadata={
        "model": reply.model,
        "inputTokens": reply.input_tokens,
        "outputTokens": reply.output_tokens,
        "costUsd": cost,
    })

run_eval("my-project", "my-dataset", solver, repeats=3, tags=["baseline"])`;

const PY_VARIANTS = `# every variant saved on the project
run_eval("my-project", "my-dataset", solver)

# only some saved variants, by name
run_eval("my-project", "my-dataset", solver, variants=["gpt-4o", "gpt-4o-mini"])

# inline variants, no portal setup needed
run_eval("my-project", "my-dataset", solver, variants=[
    {"name": "gpt-4o",      "config": {"model": "gpt-4o"}},
    {"name": "gpt-4o-mini", "config": {"model": "gpt-4o-mini"}},
])`;

const NODE_SOON = `// The Node client is in progress. Until it ships, use the HTTP protocol
// (see "Other languages") or the Python client.
//
// Planned API:
import { runEval } from "@reval/client";

await runEval({
  apiKey: process.env.REVAL_API_KEY,
  project: "my-project",
  dataset: "my-dataset",
  solve: async (input, config) => myApp.solve(input.question, config),
});`;

const JSONL = `{"id": "q1", "input": {"question": "What is 2 + 2?"}, "expected": "4"}
{"id": "q2", "input": {"question": "Capital of France?"}, "expected": "Paris", "metadata": {"topic": "geo"}}`;

const httpProtocol = (url: string) => `# 1. Start a run
curl -X POST ${url}/v1/runs \\
  -H "Authorization: Bearer $REVAL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"project": "my-project", "dataset": "my-dataset"}'
# → { "id", "url", "variants": [...], "execution": { "timeoutMs", "concurrency", "pollIntervalMs" } }

# 2. Lease tasks (repeat until "done" is true)
curl -X POST ${url}/v1/runs/$RUN_ID/lease \\
  -H "Authorization: Bearer $REVAL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"max": 8}'
# → { "tasks": [{ "attemptId", "leaseId", "itemId", "variant", "config", "input", ... }],
#     "done": false, "retryAfterMs": 1000 }

# 3. Call your app for each task, then submit the outputs
curl -X POST ${url}/v1/runs/$RUN_ID/results \\
  -H "Authorization: Bearer $REVAL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"results": [{"attemptId": "...", "leaseId": "...", "output": "4",
                    "latencyMs": 812, "metadata": {"inputTokens": 120, "outputTokens": 8}}]}'`;

// ------------------------------------------------------------------ page

export default function DocsPage() {
  const { href, subscriptionActive } = useOrg();
  const link = (path: string, label: string) => <Link href={href(path)} className="font-medium text-brand-700 underline underline-offset-2">{label}</Link>;

  return (
    <>
      <PageHeader title="Documentation" description="Install a client package, set up a project and run your first evaluation." />

      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">{s.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <Section id="how-it-works" title="How it works">
            <p>
              Reval never hosts your code. Your app keeps running in your own environment; a small client package
              fetches tasks from Reval, calls your app for each one and sends the outputs back. Every run is then
              visible under {link("/runs", "Runs")}.
            </p>
            <ArchitectureDiagram />
            <ol className="grid gap-3 sm:grid-cols-4">
              {[
                ["Start", "Your eval script starts a run for a project and dataset. Reval creates one task per item × repeat × variant."],
                ["Lease", "The client asks for work and receives tasks: each item's input plus the variant's config. Never the expected answer."],
                ["Solve", "For each task the client calls your solver, which calls your app exactly as it runs today."],
                ["Submit", "Outputs, errors, latency and usage go back to Reval and appear live in the portal."],
              ].map(([t, d], i) => (
                <li key={t} className="rounded-md bg-zinc-50 p-3 ring-1 ring-zinc-200">
                  <p className="text-xs font-semibold text-brand-700">{i + 1}. {t}</p>
                  <p className="mt-1 text-xs text-zinc-600">{d}</p>
                </li>
              ))}
            </ol>
            <h3 className="pt-2 font-semibold text-zinc-900">One task, end to end</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-500">Dataset item in Reval</p>
                <CodeBlock code={TASK_ITEM} />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-500">What your solver receives</p>
                <CodeBlock code={TASK_RECEIVED} />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <p className="text-xs font-medium text-zinc-500">What comes back and is shown in the portal</p>
                <CodeBlock code={TASK_RESULT} />
              </div>
            </div>
            <p>
              With two variants and <Code>repeats=3</Code>, this one item becomes six tasks. The variants of an item
              are handed out together and run at the same moment, so a slow minute at your model provider affects
              them all equally and the comparison stays fair.
            </p>

            <h3 className="pt-2 font-semibold text-zinc-900">Who holds what</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md p-4 ring-1 ring-zinc-200">
                <p className="font-medium text-zinc-900">Stays with you</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600">
                  <li>Your app&apos;s code and infrastructure</li>
                  <li>Model provider API keys and credentials</li>
                  <li>Access to your databases and internal services</li>
                  <li>How a variant&apos;s config maps to your app&apos;s settings</li>
                </ul>
              </div>
              <div className="rounded-md bg-brand-50/50 p-4 ring-1 ring-brand-100">
                <p className="font-medium text-zinc-900">Kept by Reval</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600">
                  <li>Datasets, including expected answers (never sent out)</li>
                  <li>Variants: named configs you want to compare</li>
                  <li>Run policy: repeats, timeouts, concurrency, retries</li>
                  <li>Every raw output, error, latency and usage figure</li>
                </ul>
              </div>
            </div>
            <p>
              Because the policy lives in Reval, the client packages stay small: they authenticate, lease, call your
              solver and submit. If a machine crashes, its unfinished tasks are handed out again, and several machines
              can work on the same run at once.
            </p>
          </Section>

          <Section id="quick-start" title="Quick start">
            <ol className="space-y-4">
              <Step n={1} title="Activate billing" done={subscriptionActive}>
                API keys and runs need an active subscription. {link("/settings/billing", "Settings → Billing")}
              </Step>
              <Step n={2} title="Create an API key">
                {link("/settings/api-keys", "Settings → API keys")}. The secret is shown once: store it as
                {" "}<Code>REVAL_API_KEY</Code> in your environment or CI secrets.
              </Step>
              <Step n={3} title="Create a project and a dataset">
                {link("/projects", "Projects")} → New project, then add a dataset and upload items
                (see <a href="#datasets" className="underline">Projects &amp; datasets</a>).
              </Step>
              <Step n={4} title="Install a client and run">
                <div className="mt-2 space-y-3">
                  <CodeBlock code={`${PYTHON_INSTALL}\nexport REVAL_API_KEY=rv_live_...\nexport REVAL_BASE_URL=${API_URL}`} />
                  <CodeBlock code={PY_QUICK} />
                </div>
              </Step>
              <Step n={5} title="Open the run">
                The script prints a link to the run. Progress, latency and every output appear live under {link("/runs", "Runs")}.
              </Step>
            </ol>
          </Section>

          <Section id="install" title="Install a client">
            <CodeTabs tabs={[
              { label: "Python", code: `${PYTHON_INSTALL}\n\n# Requires Python 3.10+. Configure with environment variables:\nexport REVAL_API_KEY=rv_live_...\nexport REVAL_BASE_URL=${API_URL}\n\n# or pass them directly:\n# run_eval(..., api_key="rv_live_...", base_url="${API_URL}")` },
              { label: "Node", badge: "Soon", code: NODE_SOON },
              { label: "Any language", code: `# No package needed: call the HTTP API directly.\n# Base URL: ${API_URL}\n# Auth:     Authorization: Bearer $REVAL_API_KEY\n# See "Other languages (HTTP)" below.` },
            ]} />
            <p>
              Clients only need your API key and the base URL <Code>{API_URL}</Code>. Your model provider keys stay in
              your app and are never sent to Reval.
            </p>
          </Section>

          <Section id="datasets" title="Projects & datasets">
            <p>
              A <strong>project</strong> is the app you&apos;re evaluating. It holds <strong>datasets</strong> (the
              test cases) and saved <strong>variants</strong> (configurations to compare). Clients refer to both by
              their slug, e.g. <Code>run_eval(&quot;my-project&quot;, &quot;my-dataset&quot;, solver)</Code>.
            </p>
            <p>Upload items as JSONL (one item per line) or JSON <Code>{"{ \"items\": [...] }"}</Code>:</p>
            <CodeBlock code={JSONL} />
            <KeyTable head={["Field", "Meaning"]} rows={[
              [<Code key="i">input</Code>, "Required. Any JSON. This is all your solver receives."],
              [<Code key="e">expected</Code>, "Optional. The reference answer, kept on the server for scoring."],
              [<Code key="id">id</Code>, "Optional. Your own id for the item, shown in the portal."],
              [<Code key="m">metadata</Code>, "Optional. Free-form labels such as topic or difficulty."],
            ]} />
            <p>
              Dataset versions are immutable: uploading or editing items in the portal creates a new version. A run uses the latest
              version when it starts (the HTTP API can pin one with <Code>datasetVersion</Code>), so past runs stay reproducible.
            </p>
          </Section>

          <Section id="solver" title="Write a solver">
            <p>
              The solver is a function in your eval script that turns one task into one output. It usually calls your
              app as a function or over HTTP.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Return a value</strong> to record it as the output (any JSON-serialisable value).</li>
              <li><strong>Accept a second argument</strong> <Code>config</Code> to receive the variant&apos;s settings.</li>
              <li><strong>Return <Code>Output(value, metadata=…)</Code></strong> to also record tokens, cost, model or raw text.</li>
              <li><strong>Raise an exception</strong> to record that attempt as an error; the run carries on.</li>
            </ul>
            <CodeBlock code={PY_SOLVER} />
          </Section>

          <Section id="variants" title="Comparing variants">
            <p>
              A run can compare several configurations, such as two models or two prompts. Every variant runs every
              item, and the variants of one item run at the same moment so they see the same load and latency.
              Save variants under {link("/projects", "Projects")} → your project → Variants.
            </p>
            <KeyTable head={["Your script passes", "Variants in the run"]} rows={[
              ["nothing", "all variants saved on the project (or one empty default)"],
              [<Code key="c">config={"{...}"}</Code>, <>one variant named <Code>default</Code></>],
              [<Code key="n">variants=[&quot;gpt-4o&quot;, ...]</Code>, "those saved variants, by name"],
              [<Code key="v">variants=[{"{name, config}"}]</Code>, "inline variants (can be mixed with names); up to 10 per run"],
            ]} />
            <CodeBlock code={PY_VARIANTS} />
            <p>
              Your app doesn&apos;t need to know about Reval or the variants. The solver maps config keys to your
              app&apos;s settings, so adding a variant in the portal needs no code change as long as it only uses keys
              your solver understands. Unknown keys (like a typo <Code>&quot;temprature&quot;</Code>) are silently ignored,
              so consider failing on keys you don&apos;t recognise.
            </p>
            <p>
              Runs copy each variant&apos;s config when they start, so editing a saved variant never changes past runs.
            </p>
          </Section>

          <Section id="usage" title="Tokens & cost">
            <p>Report usage in each output&apos;s metadata. The portal sums it per variant and per run and marks the cheapest variant.</p>
            <KeyTable head={["Metadata key", "Meaning"]} rows={[
              [<Code key="i">inputTokens</Code>, "prompt / input tokens for this attempt"],
              [<Code key="o">outputTokens</Code>, "completion / output tokens"],
              [<Code key="t">totalTokens</Code>, "if your provider only reports a total"],
              [<Code key="c">costUsd</Code>, "cost of this attempt in US dollars"],
            ]} />
            <p>
              Any other numeric key (e.g. <Code>toolCalls</Code>) is summed too; strings such as <Code>model</Code> are
              shown per attempt. Reval doesn&apos;t know model prices: compute <Code>costUsd</Code> yourself from your
              provider&apos;s current prices. Errored attempts count too, since they cost money.
            </p>
          </Section>

          <Section id="options" title="Run options">
            <KeyTable head={["Python argument", "Meaning"]} rows={[
              [<Code key="r">repeats</Code>, "Run each item this many times (model output varies)"],
              [<Code key="l">limit</Code>, "Only run the first N items"],
              [<Code key="c">concurrency</Code>, "Items in flight at once (default: the server's suggestion). With 3 variants, 4 means up to 12 solver calls"],
              [<Code key="t">timeout_ms</Code>, "Time allowed per attempt before it's handed out again"],
              [<Code key="cf">config</Code>, "Settings recorded with the run (one variant)"],
              [<Code key="v">variants</Code>, "Configurations to compare (see above)"],
              [<Code key="tg">tags</Code>, "Labels shown in the portal, e.g. a branch or commit"],
              [<Code key="vb">verbose</Code>, "Print progress (default True)"],
            ]} />
            <p>
              <Code>run_eval</Code> returns a result with <Code>id</Code>, <Code>number</Code>, <Code>url</Code>,
              {" "}<Code>status</Code>, <Code>succeeded</Code> and <Code>errored</Code>, which you can use to fail a CI job.
            </p>
          </Section>

          <Section id="http" title="Other languages (HTTP)">
            <p>
              Every client package implements the same three calls, so any language with an HTTP client works. Send
              {" "}<Code>Authorization: Bearer $REVAL_API_KEY</Code> on every request.
            </p>
            <CodeBlock code={httpProtocol(API_URL)} />
            <ul className="list-disc space-y-1 pl-5">
              <li>When a lease returns no tasks, stop if <Code>done</Code> is true, otherwise wait <Code>retryAfterMs</Code> and lease again.</li>
              <li>Tasks with the same item and repeat are one group: call your app for all of them at the same time, each limited to <Code>timeoutMs</Code>.</li>
              <li>Report failures as <Code>{"{ attemptId, leaseId, error: \"...\" }"}</Code> instead of <Code>output</Code>.</li>
              <li>Retry on 429 and 5xx with backoff. Errors look like <Code>{"{ \"error\": { \"code\", \"message\" } }"}</Code>.</li>
              <li>Unanswered leases expire and are handed out again, so several machines can work the same run.</li>
            </ul>
            <p>
              Full reference:{" "}
              <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2">
                API docs (OpenAPI)
              </a>.
            </p>
          </Section>

          <Section id="faq" title="FAQ">
            <dl className="space-y-4">
              {[
                ["Does Reval see my model API keys?", "No. Variant configs are only descriptions; your solver applies them with credentials that stay in your app."],
                ["Can my app see the expected answers?", "No. Only input is sent to clients; expected values never leave the server."],
                ["What happens if my script crashes mid-run?", "Unfinished leases expire and the tasks are handed out again. Start the script again, or let another machine pick them up. After 3 expiries an attempt is marked abandoned."],
                ["Is my app's output scored?", "Not yet. Every raw output is stored so runs can be scored later without running your app again."],
                ["Should production endpoints accept a model or prompt from the request?", "No. Call your solve function directly from the eval script, or accept these overrides only when an eval-only setting is enabled."],
              ].map(([q, a]) => (
                <div key={q}>
                  <dt className="font-medium text-zinc-900">{q}</dt>
                  <dd className="mt-1 text-zinc-600">{a}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}
