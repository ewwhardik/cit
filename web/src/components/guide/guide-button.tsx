"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startTour } from "./tour";

/** Starts the step-by-step guide. */
export function GuideButton() {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={startTour}
      aria-label="Start the guided tour"
      title="Guided tour"
    >
      <Compass className="size-4" />
    </Button>
  );
}
