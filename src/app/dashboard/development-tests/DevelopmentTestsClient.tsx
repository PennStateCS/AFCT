'use client';

import { useState } from 'react';
import { Bug, Palette, Type as TypeIcon, FileText, Wrench } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar, TabRail } from '@/components/course/course-tabs';
import { LocalNavLayout } from '@/components/local-nav';
import { useIsDesktopNav } from '@/hooks/use-desktop-nav';
import { showToast } from '@/lib/toast';
import { FontSamples } from './font-samples';
import { DesignTokens } from './design-tokens';
import { RichDescriptionDemo } from './rich-description-demo';

// The tab values are the stored identity and stay as they are; only the labels read
// differently. One source of truth for the rail and the strip.
const SECTIONS = [
  { value: 'toast', label: 'Toast Messages', Icon: Bug },
  { value: 'tokens', label: 'Design Tokens', Icon: Palette },
  { value: 'fonts', label: 'Fonts', Icon: TypeIcon },
  { value: 'editor', label: 'Rich Description', Icon: FileText },
] as const;

/** One titled block of examples, so the matrix reads as groups rather than a wall. */
function DemoGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

/** A toast trigger. Outline throughout: see the note in ToastSection. */
function ToastButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" className="w-full" onClick={onClick}>
      {label}
    </Button>
  );
}

function ToastSection() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 id="toast-tests-title" className="text-xl font-semibold">
          Toast Messages
        </h2>
        <p className="text-muted-foreground text-sm">
          Trigger each toast style used across the app.
        </p>
      </div>

      {/* All outline rather than a mix of semantic fills. Success and Error have Button
          variants, but Warning does not, so a semantic set here would mean inventing a
          variant for one demo page. Fourteen cobalt buttons implying fourteen primary
          actions was the actual problem; the grouping carries the meaning instead. */}
      <DemoGroup title="Basic">
        <ToastButton label="Success" onClick={() => showToast.success('Success toast')} />
        <ToastButton label="Error" onClick={() => showToast.error('Error toast')} />
        <ToastButton label="Warning" onClick={() => showToast.warning('Warning toast')} />
        <ToastButton label="Info" onClick={() => showToast.info('Info toast')} />
      </DemoGroup>

      <DemoGroup title="Lifecycle">
        <ToastButton
          label="Loading -> Success Update"
          onClick={() => {
            const id = showToast.loading('Loading toast', {
              description: 'Will auto-update to success in 2 seconds.',
            });
            window.setTimeout(() => {
              showToast.update(id, 'success', 'Loading complete', {
                description: 'Update helper works.',
              });
            }, 2000);
          }}
        />
        <ToastButton
          label="Success With Action"
          onClick={() =>
            showToast.success('Success with action', {
              action: { label: 'Undo', onClick: () => showToast.info('Undo clicked') },
            })
          }
        />
      </DemoGroup>

      <DemoGroup title="CRUD">
        <ToastButton label="Created" onClick={() => showToast.created('Course')} />
        <ToastButton label="Updated" onClick={() => showToast.updated('Profile')} />
        <ToastButton label="Deleted" onClick={() => showToast.deleted('Submission')} />
        <ToastButton label="Saved" onClick={() => showToast.saved('Settings')} />
      </DemoGroup>

      <DemoGroup title="Errors">
        <ToastButton
          label="Validation Error"
          onClick={() =>
            showToast.validationError('Example: One or more required fields are missing.')
          }
        />
        <ToastButton label="Network Error" onClick={() => showToast.networkError()} />
        <ToastButton label="Unauthorized" onClick={() => showToast.unauthorized()} />
        <ToastButton label="Server Error" onClick={() => showToast.serverError()} />
      </DemoGroup>

      {/* Separated from the examples: it dismisses them rather than being one of them. */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Utilities</h3>
        <Button type="button" variant="ghost" onClick={() => showToast.dismiss()}>
          Dismiss All Toasts
        </Button>
      </section>
    </div>
  );
}

/** Heading + description for a reference section, rendered on the workspace itself. */
function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children ? <p className="text-muted-foreground text-sm">{children}</p> : null}
    </div>
  );
}

export default function DevelopmentTestsClient() {
  const [tab, setTab] = useState<string>('toast');
  // xl rather than lg: the font and token references want the width beside a rail.
  const railNav = useIsDesktopNav(1280);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="development-tests-title"
            className="flex items-center gap-3 text-2xl font-semibold tracking-tight"
          >
            {/* Decorative: the heading beside it already says what this is. Wrench, the icon
                the sidebar uses for this route, in the neutral muted tile the other system
                pages use. */}
            <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Wrench className="size-5" aria-hidden="true" />
            </span>
            <span>Development Tests</span>
          </h1>
          <Badge variant="info">Dev Only</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Visual and interaction references used across the app.
        </p>
      </div>

      {/* One control at a time: two tablists under one Tabs root would duplicate its
          ARIA wiring. Below xl the strip and its select stay as they were. */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation={railNav ? 'vertical' : 'horizontal'}
        className="gap-4"
      >
        <LocalNavLayout
          className="space-y-4"
          nav={
            railNav ? (
              <TabRail
                tabs={SECTIONS}
                ariaLabel="Development test sections"
                menuLabel="Development Menu"
              />
            ) : (
              <TabBar
                ariaLabel="Development test sections"
                selectId="development-tests-tab-select"
                value={tab}
                onValueChange={setTab}
                tabs={SECTIONS}
                fill={false}
              />
            )
          }
        >
          <TabsContent value="toast" aria-labelledby="toast-tests-title">
            <ToastSection />
          </TabsContent>

          <TabsContent value="tokens" className="space-y-4">
            <SectionHeading id="design-tokens-title" title="Design Tokens">
              Live reference for the semantic colour tokens. Switch theme in the navbar to compare
              light, dark and high contrast.
            </SectionHeading>
            <DesignTokens />
          </TabsContent>

          <TabsContent value="fonts" className="space-y-4">
            <SectionHeading id="font-samples-title" title="Font Comparison" />
            <FontSamples />
          </TabsContent>

          <TabsContent value="editor" className="space-y-4">
            <SectionHeading id="rich-description-title" title="Rich Description Editor">
              The shared description editor on its own, with the plain text derived for legacy
              clients. No toolbar yet.
            </SectionHeading>
            <RichDescriptionDemo />
          </TabsContent>
        </LocalNavLayout>
      </Tabs>
    </div>
  );
}
