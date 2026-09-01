'use client';

import {
  Download,
  FileDown,
  FileImage,
  FileCode2,
  Copy,
  ClipboardType,
  Maximize2,
  ListTree,
  BookOpen,
} from 'lucide-react';
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { useViewerActions } from '@/components/viewer/viewer-actions';
import { VIEWER_DOCS_URL } from '@/lib/viewer-link';

/**
 * The standalone window's menu bar.
 *
 * `bg-card` rather than the component's default `bg-background`: this app's light background
 * token is a light blue-grey (#E7EBF0), which reads as a disabled strip across the top of a
 * window. A menu bar is expected to be the same colour as the thing it belongs to, so it takes
 * the white card surface and separates itself with the border underneath instead.
 *
 * A menu rather than a row of buttons because this window will accumulate commands that are
 * used rarely and need to be found by reading rather than recognised by icon. One menu today;
 * the shape is what makes adding the next one uneventful.
 */
export function ViewerMenubar({ downloadHref }: { downloadHref: string }) {
  // False for a grammar or a regular expression, which have nothing to export: those viewers
  // register no actions, so the items disable themselves rather than being hidden. A missing
  // menu item reads as a bug; a greyed one reads as "not for this kind of file".
  const { ready, grid, notes, layout, run } = useViewerActions();

  return (
    <Menubar className="bg-card h-auto rounded-none border-x-0 border-t-0 px-2 py-1 shadow-none">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarSub>
            <MenubarSubTrigger>Download</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem asChild>
                {/* The file exactly as it was submitted, from the same route the viewer
                    reads, which records it as a download rather than a view. */}
                <a href={downloadHref} download>
                  <Download aria-hidden="true" />
                  Original file
                </a>
              </MenubarItem>
              {/* The same machine with the layout on screen, which after auto-arranging is
                  usually far more readable than the one that was submitted. A new file: the
                  submitted one is never altered. */}
              <MenubarItem disabled={!ready} onSelect={() => run('downloadCurrent')}>
                <FileDown aria-hidden="true" />
                Current view
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Export</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem disabled={!ready} onSelect={() => run('downloadSVG')}>
                <FileCode2 aria-hidden="true" />
                SVG
              </MenubarItem>
              <MenubarItem disabled={!ready} onSelect={() => run('downloadPNG')}>
                <FileImage aria-hidden="true" />
                PNG
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          {/* Copying belongs with the other things you do to take the machine elsewhere,
              which is what an Edit menu means to most people, rather than with saving it to
              disk under File. */}
          <MenubarItem disabled={!ready} onSelect={() => run('copyPNG')}>
            <Copy aria-hidden="true" />
            Copy as PNG
          </MenubarItem>
          {/* Pastes as vector art, so it stays sharp in a slide or a printed handout, where
              the PNG above does not. */}
          <MenubarItem disabled={!ready} onSelect={() => run('copySVG')}>
            <FileCode2 aria-hidden="true" />
            Copy as SVG
          </MenubarItem>
          <MenubarSeparator />
          {/* The only one of the three that can be quoted in a reply: a picture of an
              automaton cannot be answered inline, a description of it can. */}
          <MenubarItem disabled={!ready} onSelect={() => run('copyDescription')}>
            <ClipboardType aria-hidden="true" />
            Copy as text
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          {/* First because it is the one people reach for most: after zooming or panning
              about, this is how you get the whole machine back on screen. */}
          <MenubarItem disabled={!ready} onSelect={() => run('fitToWindow')}>
            <Maximize2 aria-hidden="true" />
            Fit to window
          </MenubarItem>
          <MenubarSeparator />
          {/* A checkbox item rather than a plain one, so the menu says what the grid is
              doing now rather than only what selecting it would do. It drives the same state
              as the Grid button in the viewer's own toolbar, so the two never disagree. */}
          <MenubarCheckboxItem
            checked={grid}
            disabled={!ready}
            onCheckedChange={() => run('toggleGrid')}
          >
            Grid
          </MenubarCheckboxItem>
          {/* On by default: a note is the author's own words, part of the answer rather than
              decoration. Off is for a busy machine where they cover the states. They are only
              drawn in the "As drawn" layout, so this does nothing once auto-arranged. */}
          <MenubarCheckboxItem
            checked={notes}
            disabled={!ready}
            onCheckedChange={() => run('toggleNotes')}
          >
            JFLAP Notes
          </MenubarCheckboxItem>
          <MenubarSeparator />
          {/* The same content the dialog viewers show in a panel under the graph. Here it
              opens in a window, so the graph keeps the full height of the screen. */}
          <MenubarItem disabled={!ready} onSelect={() => run('showTextRepresentation')}>
            <ListTree aria-hidden="true" />
            Text representation
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Layout</MenubarSubTrigger>
            <MenubarSubContent>
              {/* A radio group, not two checkboxes: the machine is drawn one way or the
                  other, never both and never neither, and the control should say so. */}
              <MenubarRadioGroup
                value={layout}
                onValueChange={(next) =>
                  run(next === 'as-drawn' ? 'setAsDrawn' : 'setAutoArranged')
                }
              >
                <MenubarRadioItem value="as-drawn" disabled={!ready}>
                  As drawn
                </MenubarRadioItem>
                <MenubarRadioItem value="auto" disabled={!ready}>
                  Auto-arranged
                </MenubarRadioItem>
              </MenubarRadioGroup>
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          {/* A plain link, so it behaves like one: middle-click, copy the address, open in a
              background tab. `noopener` because it leaves the application. */}
          <MenubarItem asChild>
            <a href={VIEWER_DOCS_URL} target="_blank" rel="noopener noreferrer">
              <BookOpen aria-hidden="true" />
              Documentation
            </a>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
