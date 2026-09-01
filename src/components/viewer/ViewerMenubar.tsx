'use client';

import { Download, FileImage, FileCode2, Copy } from 'lucide-react';
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

/**
 * The standalone window's menu bar.
 *
 * A menu rather than a row of buttons because this window will accumulate commands that are
 * used rarely and need to be found by reading rather than recognised by icon. One menu today;
 * the shape is what makes adding the next one uneventful.
 */
export function ViewerMenubar({ downloadHref }: { downloadHref: string }) {
  // False for a grammar or a regular expression, which have nothing to export: those viewers
  // register no actions, so the items disable themselves rather than being hidden. A missing
  // menu item reads as a bug; a greyed one reads as "not for this kind of file".
  const { ready, grid, layout, run } = useViewerActions();

  return (
    <Menubar className="rounded-none border-x-0 border-t-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem asChild>
            {/* The file exactly as it was submitted, from the same route the viewer reads,
                which records it as a download rather than a view. */}
            <a href={downloadHref} download>
              <Download aria-hidden="true" />
              Download original file
            </a>
          </MenubarItem>
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
            Copy PNG to clipboard
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
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
    </Menubar>
  );
}
