"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 cursor-pointer touch-manipulation items-center rounded-full border border-transparent transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-2 focus-visible:ring-white/20 data-[size=default]:h-[18px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] data-checked:bg-zinc-200 data-unchecked:bg-white/[0.1] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      style={{ touchAction: "manipulation" }}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      >
        <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(15,23,42,0.35)_0%,rgba(71,85,105,0.12)_40%,rgba(148,180,220,0.28)_72%,rgba(186,214,245,0.48)_88%,rgba(226,240,255,0.58)_100%)] opacity-0 transition-opacity duration-300 ease-out group-data-unchecked/switch:group-hover/switch:opacity-100 group-data-disabled/switch:opacity-0" />
      </span>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none relative z-10 block rounded-full shadow-sm ring-0 transition-all group-data-[size=default]/switch:size-[14px] group-data-[size=sm]/switch:size-3 group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-1px)] group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-1px)] group-data-[size=default]/switch:data-unchecked:translate-x-[2px] group-data-[size=sm]/switch:data-unchecked:translate-x-[1px] data-checked:bg-zinc-800 data-unchecked:bg-white/60"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
