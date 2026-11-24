"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  normalizeTheme,
} from "@/lib/theme-preference";
import { settingsSchema, type SettingsValues } from "@/lib/settings-schema";
import {
  PREFERENCES_DEFAULTS,
  SHARE_TTL_OPTIONS,
  loadPreferences,
  savePreferences,
  type ShareTtlSeconds,
} from "@/lib/preferences";

// Every field here drives real behaviour: Theme is applied by next-themes, the
// default project pre-fills the Generate form, and the default share lifetime
// pre-selects the Share dialog. Values persist to this browser only (there is
// no account system). See docs/features/settings.md.
const defaultValues: SettingsValues = {
  theme: DEFAULT_THEME,
  defaultProject: PREFERENCES_DEFAULTS.defaultProject,
  defaultShareTtl: String(PREFERENCES_DEFAULTS.defaultShareTtl),
};

export function SettingsForm() {
  const [submitting, setSubmitting] = useState(false);
  // next-themes is the single owner of the theme; the radio group is a view
  // onto it, which is why the header toggle and this form always agree.
  const { setTheme, theme } = useTheme();
  const hydratedRef = useRef(false);
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues,
  });

  // Open pre-filled: hydrate once, after next-themes has resolved the theme.
  useEffect(() => {
    if (hydratedRef.current || theme === undefined) return;
    hydratedRef.current = true;
    const prefs = loadPreferences();
    form.reset({
      theme: normalizeTheme(theme),
      defaultProject: prefs.defaultProject,
      defaultShareTtl: String(prefs.defaultShareTtl),
    });
  }, [form, theme]);

  const onSubmit = async (values: SettingsValues) => {
    setSubmitting(true);
    setTheme(values.theme);
    const stored = savePreferences({
      defaultProject: values.defaultProject,
      defaultShareTtl: Number(values.defaultShareTtl) as ShareTtlSeconds,
    });
    setSubmitting(false);
    if (stored) {
      toast.success("Preferences saved in this browser");
    } else {
      toast.warning("Theme applied; other preferences not stored", {
        description: "Your browser blocked local storage, so they won't persist.",
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">Clips</CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-6">
            <FormField
              control={form.control}
              name="defaultProject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default project</FormLabel>
                  <FormControl>
                    <Input placeholder="demo" className="w-72 font-mono" {...field} />
                  </FormControl>
                  <FormDescription>
                    Pre-fills the project on the Generate form. Each project gets its own
                    manifest at <code>video/manifests/&lt;project&gt;.jsonl</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultShareTtl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default share link lifetime</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-60">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SHARE_TTL_OPTIONS.map((o) => (
                        <SelectItem key={o.seconds} value={String(o.seconds)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Pre-selected in the Share dialog. Links are presigned and stop working
                    when they expire (7 days at most).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">Appearance</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <FormField
              control={form.control}
              name="theme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Theme</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex gap-6"
                    >
                      {THEME_OPTIONS.map((t) => (
                        <label
                          key={t}
                          className="flex items-center gap-2 text-sm capitalize cursor-pointer"
                        >
                          <RadioGroupItem value={t} />
                          {t}
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormDescription>
                    Applied when you save. The header toggle changes it too.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => form.reset(defaultValues)}>
            Reset
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
