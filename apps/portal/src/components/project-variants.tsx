"use client";

import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { ConfigChips } from "@/components/run-ui";
import { Alert, Button, Card, Code, EmptyState, Field, Input, Loading, Modal, Table, Td, Textarea, Th } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useOrg } from "@/lib/hooks";
import type { ProjectVariant } from "@/lib/types";

const MAX_VARIANTS = 10; // matches the API

/** Saved configurations of a project. Runs started without config/variants compare all of them. */
export function ProjectVariants({ projectId }: { projectId: string }) {
  const { orgApi, can } = useOrg();
  const path = orgApi(`/projects/${projectId}/variants`);
  const { data, error, mutate } = useSWR<{ variants: ProjectVariant[] }>(path);
  const [editing, setEditing] = useState<ProjectVariant | "new" | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const isAdmin = can("admin");
  const full = (data?.variants.length ?? 0) >= MAX_VARIANTS;

  async function remove(v: ProjectVariant) {
    if (!confirm(`Delete variant “${v.name}”? Runs that already used it keep their config.`)) return;
    setDeleteError(null);
    try {
      await api(`${path}/${v.id}`, { method: "DELETE" });
      await mutate();
    } catch (e) {
      setDeleteError(errorMessage(e));
    }
  }

  const addButton = isAdmin && (
    <Button size="sm" disabled={full} title={full ? `At most ${MAX_VARIANTS} variants per project` : undefined}
      onClick={() => setEditing("new")}>Add variant</Button>
  );

  return (
    <Card title="Variants" padded={false} actions={addButton}>
      {deleteError && <div className="p-4 pb-0"><Alert>{deleteError}</Alert></div>}
      {error ? <div className="p-4"><Alert>{errorMessage(error)}</Alert></div>
        : !data ? <Loading />
        : data.variants.length === 0 ? (
          <EmptyState title="No saved variants" action={addButton}>
            Save the configurations you want to compare, e.g. two models or two prompts.
            Every run of this project will then run each item with every variant, side by side.
          </EmptyState>
        ) : (
          <>
            <Table>
              <thead className="bg-zinc-50">
                <tr><Th className="w-48">Name</Th><Th>Config</Th>{isAdmin && <Th className="w-36" />}</tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.variants.map((v) => (
                  <tr key={v.id}>
                    <Td className="font-mono text-sm font-medium text-zinc-900">{v.name}</Td>
                    <Td>{Object.keys(v.config).length ? <ConfigChips config={v.config} max={6} /> : <span className="text-xs text-zinc-400">empty</span>}</Td>
                    {isAdmin && (
                      <Td className="text-right whitespace-nowrap">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>Edit</Button>{" "}
                        <Button size="sm" variant="ghost" onClick={() => remove(v)}>Delete</Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500">
              Runs started without <Code>config</Code> or <Code>variants</Code> compare all of these.
              To run only some, pass their names: <Code>{`variants: ["${data.variants[0]!.name}"]`}</Code>.
              Your solver receives each variant’s config with its tasks and applies it with your own API keys.
            </p>
          </>
        )}
      <VariantModal path={path} variant={editing} onClose={() => setEditing(null)}
        onSaved={async () => { await mutate(); setEditing(null); }} />
    </Card>
  );
}

function VariantModal({ path, variant, onClose, onSaved }: {
  path: string; variant: ProjectVariant | "new" | null; onClose: () => void; onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const existing = variant && variant !== "new" ? variant : null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const text = String(form.get("config") ?? "").trim();
    let config: unknown = {};
    if (text) {
      try { config = JSON.parse(text); } catch { setError("Config is not valid JSON."); return; }
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      setError("Config must be a JSON object, e.g. {\"model\": \"gpt-5\"}.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(existing ? `${path}/${existing.id}` : path, {
        method: existing ? "PATCH" : "POST", body: { json: { name, config } },
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function close() { setError(null); onClose(); }

  return (
    <Modal open={variant !== null} onClose={close} title={existing ? `Edit variant “${existing.name}”` : "Add variant"}>
      {/* key: reset the uncontrolled fields when switching between variants */}
      <form key={existing?.id ?? "new"} onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" hint="Shown in run results, and used to pick this variant from code.">
          <Input name="name" required maxLength={50} autoFocus defaultValue={existing?.name} placeholder="gpt-5" />
        </Field>
        <Field label="Config (JSON object)"
          hint="Whatever your solver needs to know, e.g. model, prompt version, temperature. Don't put API keys here: everyone in the organization can see it.">
          <Textarea name="config" rows={8} defaultValue={existing ? JSON.stringify(existing.config, null, 2) : ""}
            placeholder={'{\n  "provider": "openai",\n  "model": "gpt-5",\n  "prompt": "v2"\n}'} />
        </Field>
        {existing && <p className="text-xs text-zinc-500">Changes apply to new runs. Past runs keep the config they ran with.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" loading={saving}>{existing ? "Save" : "Add variant"}</Button>
        </div>
      </form>
    </Modal>
  );
}
