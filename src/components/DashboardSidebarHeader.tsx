'use client';

import React from 'react';
import { SidebarHeader, useSidebar } from '@/components/ui/sidebar';
import { usePathname } from 'next/navigation';

import Link from 'next/link';
import { AuthBrandMark } from '@/components/auth/AuthBrandMark';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The AFCT lockup at the top of the dashboard sidebar.
 *
 * The same mark and the same two-line wordmark the sign-in page uses, so the product a person
 * signs into and the product they land in are visibly one thing. It used to be a nav row like
 * any other: a generic Lucide dashboard glyph and the words "AFCT Dashboard" at row size,
 * which made the brand the least distinctive thing in a column of fifteen labels.
 *
 * `AuthBrandMark` is reused rather than redrawn. It is presentation-only and takes both of its
 * colours from the caller, which is exactly why it can sit on the near-black sign-in panel and
 * on this rail without a second interpretation of the logo existing anywhere.
 *
 * Not the sign-in lockup wholesale, though: that one is a hero, sized in `text-5xl` with the
 * "Automated Feedback for Computing Theory" line under it. In a persistent 256px rail the
 * tagline turns navigation into a marketing panel, so only the mark, AFCT and DASHBOARD are
 * here. The colours are the sign-in page's: cobalt frame, near-white states, tracked blue
 * DASHBOARD. No teal, and none of the green the course rows use.
 */
export default function DashboardSidebarHeader() {
  const pathname = usePathname();
  const { state, isMobile, setOpenMobile } = useSidebar();
  // The mobile drawer is always the full-width one: `state` tracks the DESKTOP sidebar and is
  // whatever it was last left at, so a drawer opened after collapsing the rail would otherwise
  // show a lone mark in 288px of space. Same test the nav below uses.
  const collapsed = state === 'collapsed' && !isMobile;
  const isDashboard = pathname === '/dashboard';

  return (
    // p-0 so the padding below is the brand's own. The header's default `p-2` would add to it
    // and put the mark 8px further in than the nav icons underneath.
    <SidebarHeader className="p-0">
      <TooltipProvider delayDuration={100}>
        {/* Uncontrolled, with the content hidden while expanded rather than `open` toggled
            between false and undefined, which warns about a controlled/uncontrolled switch. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/dashboard"
              aria-current={isDashboard ? 'page' : undefined}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
              /*
               * Deliberately not a SidebarMenuButton. That primitive carries the cobalt
               * `data-[active=true]` fill, so standing on /dashboard painted the brand as a
               * selected nav row, which is the one thing a wordmark should never look like.
               *
               * Hover is a foreground shift and nothing else: a background would put the brand
               * back in the same visual family as the rows it sits above. The focus ring is
               * the sidebar's own, kept because this is a real link.
               */
              className={
                'focus-visible:ring-sidebar-ring flex items-center rounded-md outline-hidden ' +
                'transition-opacity hover:opacity-80 focus-visible:ring-2 ' +
                (collapsed ? 'justify-center px-2 py-4' : 'gap-3 px-4 py-4')
              }
            >
              {/*
                44px expanded, which is what the mark needs for its internal detail to survive:
                three states, three arrowheads and a double accepting ring. Below about 40 the
                transitions start closing up against the states. 28px in the 56px rail, which
                leaves 14px of air either side and still reads as the hexagon-and-automaton.

                Cobalt frame, near-white states: the sign-in page's pairing for a dark surface,
                set here rather than inside the mark because the same component takes the
                card's navy on the light mobile header.
              */}
              <AuthBrandMark
                className={'shrink-0 text-blue-400 ' + (collapsed ? 'size-7' : 'size-11')}
                accentClassName="text-sidebar-foreground"
              />

              {/* Hidden outright in the rail rather than clipped: half a wordmark reads as a
                  rendering fault. The tooltip carries the name there instead. */}
              {collapsed ? null : (
                // aria-hidden, with the accessible name supplied once below. Left readable,
                // the link announces "AFCT Dashboard AFCT Dashboard": the two visible spans
                // concatenate into the same words the sr-only name has to provide for the
                // rail, where there is no visible text at all.
                <span aria-hidden="true" className="flex min-w-0 flex-col">
                  <span className="text-sidebar-foreground text-2xl leading-none font-semibold tracking-tight">
                    AFCT
                  </span>
                  {/* The sign-in page's tracked line, a size down: at 0.28em the letters are
                      spaced far enough to read as a mark rather than as a word, which is what
                      keeps it from competing with AFCT above or with the nav labels below. */}
                  <span className="mt-1.5 text-[10px] font-medium tracking-[0.28em] text-blue-300 uppercase">
                    Dashboard
                  </span>
                </span>
              )}

              {/* One accessible name in both states. The mark is decorative and the wordmark
                  is hidden from AT, so in the rail this is the only thing naming the link. */}
              <span className="sr-only">AFCT Dashboard</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            hidden={!collapsed}
            className="bg-sidebar text-sidebar-foreground px-5 text-sm shadow"
            sideOffset={10}
          >
            AFCT Dashboard
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SidebarHeader>
  );
}
