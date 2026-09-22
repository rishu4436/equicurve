import { Suspense } from "react";
import { CreateWizard } from "@/components/create/CreateWizard";

export default function CreatePage() {
  return (
    <Suspense
      fallback={<div className="text-fg-secondary">Loading create wizard…</div>}
    >
      <CreateWizard />
    </Suspense>
  );
}
