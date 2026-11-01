import { Box } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CampusExplorer } from "@/components/campus3d/campus-explorer";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { getCampusLive } from "@/server/campus-live";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "3D campus" };

export default async function CampusPage() {
  const user = await requireUser();
  const data = await getCampusLive();
  return (
    <>
      <PageHeader
        title="3D campus"
        description="Fly over or walk through the campus. Each storey is one room, lit by what runs there in the chosen hour; step inside to see the class and the seats in use."
      />
      {data ? (
        <CampusExplorer slots={data.slots} rooms={data.rooms} live={data.live} />
      ) : (
        <Card>
          <EmptyState
            icon={<Box className="size-7" strokeWidth={1.5} />}
            title="The campus lights up once a timetable has been generated."
            action={
              user.role === "admin" ? (
                <Link href="/generate">
                  <Button variant="primary">Generate</Button>
                </Link>
              ) : null
            }
          />
        </Card>
      )}
    </>
  );
}
