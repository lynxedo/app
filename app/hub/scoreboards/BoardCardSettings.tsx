'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CustomBoardManager } from '@/components/hub/scoreboards/widgets/CustomBoardManager'

/**
 * The ⚙ on a board card in the Scoreboards list.
 *
 * Renaming and deleting were only reachable by OPENING a board and finding a button
 * that used to be labelled "Share" — so neither was findable, which is how Ben came
 * to report they didn't exist. Managing a list of things belongs on the list.
 *
 * ⚠ Rendered as a SIBLING of the card's <Link>, never inside it. A <button> nested in
 * an <a> is invalid HTML and the outer link swallows the click, so the card stays one
 * big link to open the board and this sits above it on its own layer.
 */
export default function BoardCardSettings({ slug, title }: { slug: string; title: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Always visible on touch, where there is no hover to reveal it.
        className="absolute right-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-lg border border-sky-400/15 bg-[#020c16]/80 text-[12px] text-gray-400 transition hover:border-sky-400/40 hover:text-sky-200"
        aria-label={`Settings for ${title}`}
        title="Rename, share or delete this scoreboard"
      >
        ⚙
      </button>
      {open ? (
        <CustomBoardManager
          slug={slug}
          onClose={() => setOpen(false)}
          // Re-read the list rather than patching it locally: the panel can change the
          // name AND the share count, and the card shows both.
          onRenamed={() => router.refresh()}
          onDeleted={() => { setOpen(false); router.refresh() }}
          // Straight into the copy. A real route here, so a push is right — it
          // keeps the list a back-button away if the copy wasn't what they wanted.
          onDuplicated={newSlug => { setOpen(false); router.push(`/hub/scoreboards/${newSlug}`) }}
        />
      ) : null}
    </>
  )
}
