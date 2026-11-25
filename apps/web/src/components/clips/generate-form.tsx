"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Clapperboard } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { JobProgress } from "@/components/clips/job-progress";
import { STEP_OPTIONS, clipHref, type GenerateDefaults } from "@/lib/clip-links";
import { loadGenerateDraft, saveGenerateDraft } from "@/lib/generate-draft";
import { defaultModelId } from "@/lib/generation";
import { PROJECT_NAME_RE, loadPreferences } from "@/lib/preferences";
import { useGenerateClip, useModels, useProjects } from "@/lib/queries";
import type { GenerationJob } from "@wan-video-generation-archive/shared";

const FRAME_OPTIONS = ["17", "33", "49", "81", "121"] as const;

const schema = z.object({
  project: z.string().regex(PROJECT_NAME_RE, "Lowercase letters, digits and hyphens"),
  prompt: z.string().trim().min(1, "Describe the clip").max(2000),
  negative_prompt: z.string().max(2000),
  seed: z
    .string()
    .regex(/^\d*$/, "Whole number, or leave blank for random")
    .refine((v) => v === "" || Number(v) <= 4294967295, "At most 4294967295"),
  model_id: z.string().min(1),
  resolution: z.string().min(1),
  num_frames: z.enum(FRAME_OPTIONS),
  num_inference_steps: z.string(),
  guidance_scale: z
    .string()
    .refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 20), "Between 0 and 20"),
});

type Values = z.infer<typeof schema>;

/** Fields the API's device-aware preset (`ModelInfo.recommended`) fills in. */
const PRESET_FIELDS = ["resolution", "num_frames", "num_inference_steps"] as const;

function initialValues(prefill: GenerateDefaults): Values {
  const frames = prefill.num_frames ?? "49";
  return {
    project: prefill.project ?? "demo",
    prompt: prefill.prompt ?? "",
    negative_prompt: prefill.negative_prompt ?? "",
    seed: prefill.seed ?? "",
    // Empty until /models says which model can run on this machine.
    model_id: prefill.model_id ?? "",
    resolution: prefill.resolution ?? "480p",
    num_frames: (FRAME_OPTIONS as readonly string[]).includes(frames)
      ? (frames as Values["num_frames"])
      : "49",
    num_inference_steps: prefill.num_inference_steps ?? "30",
    guidance_scale: prefill.guidance_scale ?? "",
  };
}

export function GenerateForm({ prefill }: { prefill: GenerateDefaults }) {
  const router = useRouter();
  const { data: models = [] } = useModels();
  const { data: projects = [] } = useProjects();
  const generate = useGenerateClip();
  const [jobId, setJobId] = useState<string>();
  const hydrated = useRef(false);
  // Fields the URL or the restored draft set; the device preset leaves them alone.
  const pinned = useRef(new Set<string>(Object.keys(prefill)));
  const presetApplied = useRef(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initialValues(prefill) });

  // Order of precedence: URL ("Use these settings") > this tab's unsent draft >
  // the saved default project and the device preset > static defaults.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const draft = Object.keys(prefill).length === 0 ? loadGenerateDraft() : undefined;
    if (draft) {
      const known = Object.fromEntries(
        Object.entries(draft).filter(([k]) => k in form.getValues()),
      ) as Partial<Values>;
      form.reset({ ...form.getValues(), ...known });
      Object.keys(known).forEach((k) => pinned.current.add(k));
    }
    if (!pinned.current.has("project")) form.setValue("project", loadPreferences().defaultProject);
  }, [form, prefill]);

  // Runs after the restore above in the same commit, so it never saves over the draft unread.
  const allValues = useWatch({ control: form.control });
  useEffect(() => saveGenerateDraft(allValues), [allValues]);

  const modelId = useWatch({ control: form.control, name: "model_id" });
  const model = useMemo(() => models.find((m) => m.id === modelId), [models, modelId]);
  const runnable = model?.available ?? false;
  const rec = model?.recommended;
  const offCuda = !!model?.run_device && model.run_device !== "cuda";

  // Start from the API's device-aware preset (light off CUDA) once a model is known.
  useEffect(() => {
    if (!model || presetApplied.current) return;
    presetApplied.current = true;
    const values: Record<(typeof PRESET_FIELDS)[number], string> = {
      resolution: model.recommended.resolution,
      num_frames: String(model.recommended.num_frames),
      num_inference_steps: String(model.recommended.num_inference_steps),
    };
    for (const field of PRESET_FIELDS) {
      if (pinned.current.has(field)) continue;
      if (field === "num_frames" && !(FRAME_OPTIONS as readonly string[]).includes(values[field])) continue;
      form.setValue(field, values[field] as never);
    }
  }, [form, model]);

  // Open the new clip as soon as the job this page follows succeeds.
  const openClip = useCallback(
    (job: GenerationJob) => {
      if (!job.clip_id) return;
      toast.success("Clip ready", { description: "Opening it." });
      router.push(clipHref(job.project, job.clip_id));
    },
    [router],
  );

  // Pre-select the model the API says can run here (not a hardcoded one).
  useEffect(() => {
    if (form.getValues("model_id")) return;
    const id = defaultModelId(models);
    if (id) form.setValue("model_id", id);
  }, [form, models]);

  // Keep the resolution valid for the chosen model.
  useEffect(() => {
    if (!model) return;
    const current = form.getValues("resolution");
    if (!model.resolutions.some((r) => r.name === current)) {
      const fallback = model.resolutions.find((r) => r.name === "480p") ?? model.resolutions[0];
      form.setValue("resolution", fallback.name);
    }
  }, [form, model]);

  const onSubmit = (v: Values) => {
    generate.mutate(
      {
        project: v.project,
        prompt: v.prompt.trim(),
        negative_prompt: v.negative_prompt.trim() || null,
        seed: v.seed === "" ? null : Number(v.seed),
        model_id: v.model_id,
        resolution: v.resolution,
        num_frames: Number(v.num_frames) as 17 | 33 | 49 | 81 | 121,
        num_inference_steps: Number(v.num_inference_steps),
        guidance_scale: v.guidance_scale === "" ? 5 : Number(v.guidance_scale),
      },
      {
        onSuccess: (job) => {
          setJobId(job.job_id);
          toast.success("Generation queued", { description: `Project ${job.project}` });
        },
        onError: (e) => toast.error("Could not queue the clip", { description: e.message }),
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader className="border-b border-border py-4 px-5">
              <CardTitle className="card-title">Prompt</CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <FormField control={form.control} name="prompt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Prompt</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="A red fox trotting through fresh snow at dawn, cinematic" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="negative_prompt" render={({ field }) => (
                <FormItem>
                  <FormLabel>Negative prompt</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional, e.g. blurry, low quality, watermark" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="project" render={({ field }) => (
                <FormItem>
                  <FormLabel>Project</FormLabel>
                  <FormControl>
                    <Input list="project-options" placeholder="demo" className="font-mono w-72" {...field} />
                  </FormControl>
                  <datalist id="project-options">
                    {projects.map((p) => <option key={p.name} value={p.name} />)}
                  </datalist>
                  <FormDescription>
                    Clips are grouped by project under <code>video/recent/&lt;project&gt;/</code>. It
                    starts from your Settings default; pick an existing project or type a new name.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Right after the prompt, so it is in view on a laptop-height window
              without scrolling; the settings below already hold usable values. */}
          <div className="flex items-center justify-end gap-3">
            <p className="text-xs text-muted-foreground">Settings below start from the preset suggested for this machine.</p>
            <Button type="submit" disabled={generate.isPending || !runnable}>
              <Clapperboard className="h-4 w-4" aria-hidden="true" />
              {generate.isPending ? "Queuing..." : "Generate clip"}
            </Button>
          </div>

          <Card>
            <CardHeader className="border-b border-border py-4 px-5">
              <CardTitle className="card-title">Model and settings</CardTitle>
            </CardHeader>
            <CardContent className="p-5 grid gap-4 sm:grid-cols-2">
              <SelectField form={form} name="model_id" label="Model"
                hint={model && !model.available
                  ? (model.unavailable_reason ?? "This model cannot run on this machine.")
                  : "Pinned revision. Models this machine cannot run are disabled."}
                hintTone={model && !model.available ? "destructive" : undefined}
                options={models.map((m) => ({
                  value: m.id,
                  label: m.available ? m.label : `${m.label} (needs a CUDA GPU)`,
                  disabled: !m.available,
                }))} />
              <SelectField form={form} name="resolution" label="Resolution" hint={`Suggested here: ${rec?.resolution ?? "480p"}.`}
                options={(model?.resolutions ?? []).map((r) => ({ value: r.name, label: `${r.name} (${r.width}x${r.height})` }))} />
              <SelectField form={form} name="num_frames" label="Frames" hint={`Suggested here: ${rec?.num_frames ?? 49} frames (${model ? ((rec?.num_frames ?? 49) / model.fps).toFixed(1) : "2.0"} s).`}
                options={FRAME_OPTIONS.map((f) => ({ value: f, label: `${f} frames` }))} />
              <SelectField form={form} name="num_inference_steps" label="Steps" hint={`Suggested here: ${rec?.num_inference_steps ?? 30}. Fewer is faster.`}
                options={STEP_OPTIONS.map((s) => ({ value: String(s), label: `${s} steps` }))} />
              <FormField control={form.control} name="seed" render={({ field }) => (
                <FormItem>
                  <FormLabel>Seed</FormLabel>
                  <FormControl><Input inputMode="numeric" placeholder="Random" className="font-mono" {...field} /></FormControl>
                  <FormDescription>Blank picks a random seed; it is still recorded.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="guidance_scale" render={({ field }) => (
                <FormItem>
                  <FormLabel>Guidance scale</FormLabel>
                  <FormControl><Input inputMode="decimal" placeholder="5.0" className="font-mono" {...field} /></FormControl>
                  <FormDescription>Default: 5.0.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              {offCuda && (
                <p className="sm:col-span-2 text-xs text-muted-foreground">
                  This API generates on <span className="font-mono">{model?.run_device}</span>, without
                  a CUDA GPU, where every step is many times slower. The form starts from the light
                  preset ({rec?.resolution}, {rec?.num_frames} frames, {rec?.num_inference_steps} steps);
                  raise the settings once you know how long a clip takes here.
                </p>
              )}
            </CardContent>
          </Card>
        </form>
      </Form>
      <JobProgress
        jobId={jobId}
        onSucceeded={openClip}
        idleText="Submit the form to queue a clip. The first run of a model downloads its pinned weights from huggingface.co; this card shows the download, then the model load, then each step."
      />
    </div>
  );
}

type SelectName = "model_id" | "resolution" | "num_frames" | "num_inference_steps";

function SelectField({
  form,
  name,
  label,
  hint,
  hintTone,
  options,
}: {
  form: ReturnType<typeof useForm<Values>>;
  name: SelectName;
  label: string;
  hint: string;
  hintTone?: "destructive";
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select onValueChange={field.onChange} value={field.value}>
          <FormControl>
            <SelectTrigger className="w-full"><SelectValue placeholder="Loading..." /></SelectTrigger>
          </FormControl>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={o.disabled}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormDescription className={hintTone === "destructive" ? "text-destructive" : undefined}>{hint}</FormDescription>
        <FormMessage />
      </FormItem>
    )} />
  );
}
