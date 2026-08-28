import { MasonryGrid } from "@egjs/grid";
import { useEffect, useRef, useState } from "preact/hooks";

import type { SessionDetail } from "../../shared/contracts.js";

type Job = SessionDetail["runs"][number]["jobs"][number];
type Run = SessionDetail["runs"][number];
type Output = Job["outputs"][number];

type Props = {
  session: SessionDetail;
  busyItemId: string | null;
  onCancelJob: (jobId: string) => void;
  onDeleteOutput: (assetId: string) => void;
  onDismissJob: (jobId: string) => void;
  onClearGenerationLog: () => void;
};

export function OutputSection({
  session,
  busyItemId,
  onCancelJob,
  onDeleteOutput,
  onDismissJob,
  onClearGenerationLog,
}: Props) {
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const jobs = session.runs.flatMap((run) =>
    run.jobs.map((job) => ({ job, run })),
  );
  const failures = jobs.filter(
    ({ job }) => job.status === "failed" || job.status === "partial",
  );
  const galleryItems = jobs.flatMap(({ job, run }) => {
    if (
      job.status === "failed" ||
      job.status === "partial" ||
      job.status === "cancelled"
    ) {
      return [];
    }

    const outputs = job.outputs.map((output) => ({ job, run, output }));
    if (job.status !== "queued" && job.status !== "running") return outputs;

    return [
      ...outputs,
      ...Array.from(
        { length: Math.max(0, job.requestedCount - outputs.length) },
        () => ({ job, run, output: undefined }),
      ),
    ];
  });
  const lightboxImage = galleryItems.find(
    ({ output }) => output?.id === lightboxId,
  );
  const actionsBusy = busyItemId !== null;
  const galleryKey = galleryItems
    .map(({ job, output }) => output?.id ?? job.id)
    .join(":");

  useEffect(() => {
    const element = galleryRef.current;
    if (!element || !galleryKey) return;

    const small = window.matchMedia("(min-width: 40rem)");
    const large = window.matchMedia("(min-width: 64rem)");
    const grid = new MasonryGrid(element, {
      align: "start",
      gap: large.matches ? 16 : 8,
      useResizeObserver: true,
      observeChildren: true,
    });
    const updateLayout = () => {
      grid.gap = large.matches ? 16 : 8;
      grid.renderItems({ useOrgResize: true });
    };

    small.addEventListener("change", updateLayout);
    large.addEventListener("change", updateLayout);
    grid.renderItems();

    return () => {
      small.removeEventListener("change", updateLayout);
      large.removeEventListener("change", updateLayout);
      grid.destroy();
    };
  }, [galleryKey]);

  if (!session.runs.length) return null;

  return (
    <section class="space-y-4 py-5">
      {galleryItems.length > 0 && (
        <div ref={galleryRef}>
          {galleryItems.map(({ job, run, output }, index) => (
            <GalleryItem
              key={output?.id ?? `${job.id}-placeholder-${index}`}
              job={job}
              run={run}
              output={output}
              actionsBusy={actionsBusy}
              busy={busyItemId === (output?.id ?? job.id)}
              revealed={revealedItemId === (output?.id ?? job.id)}
              onReveal={() => setRevealedItemId(output?.id ?? job.id)}
              onOpen={setLightboxId}
              onCancel={() => onCancelJob(job.id)}
              onDelete={() => output && onDeleteOutput(output.id)}
            />
          ))}
        </div>
      )}

      {failures.length > 0 && (
        <details class="collapse-arrow border-base-300 bg-base-100 collapse border">
          <summary class="collapse-title flex min-h-0 items-center gap-2 py-3 text-sm font-medium">
            Generation log
            <span class="badge badge-error badge-sm">{failures.length}</span>
          </summary>
          <div class="collapse-content px-0 pb-0">
            <div class="border-base-300 flex justify-end border-t px-4 py-2">
              <button
                class="btn btn-ghost btn-xs"
                type="button"
                disabled={actionsBusy}
                onClick={onClearGenerationLog}
              >
                {busyItemId === session.id && (
                  <span class="loading loading-spinner loading-xs" />
                )}
                {busyItemId === session.id ? "Deleting..." : "Delete all"}
              </button>
            </div>
            <ul class="divide-base-300 divide-y border-t border-base-300">
              {failures.map(({ job, run }) => (
                <li
                  key={job.id}
                  class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start"
                >
                  <div class="min-w-0 grow">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-medium">{job.modelName}</span>
                      <span class="badge badge-error badge-sm">
                        {job.status === "partial" ? "Partial" : "Failed"}
                      </span>
                    </div>
                    <p class="text-base-content/45 mt-0.5 truncate text-xs">
                      {job.providerId} / {job.modelId} ·{" "}
                      {run.options.resolution} · {run.options.aspectRatio} ·{" "}
                      {formatDate(job.createdAt)}
                    </p>
                    <p class="text-error mt-2 text-sm">
                      {job.errorMessage ?? "Generation failed."}
                    </p>
                    <p class="text-base-content/50 mt-1 text-xs">
                      {formatCost(job)}
                    </p>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs btn-square self-end sm:self-auto"
                    type="button"
                    disabled={actionsBusy}
                    onClick={() => onDismissJob(job.id)}
                    aria-label={`Delete ${job.modelName} log entry`}
                  >
                    {busyItemId === job.id ? (
                      <span class="loading loading-spinner loading-xs" />
                    ) : (
                      <TrashIcon />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {lightboxImage?.output && (
        <dialog
          open
          class="modal modal-open bg-black/80 p-4"
          aria-label={`Generated image from ${lightboxImage.job.modelName}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLightboxId(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxId(null);
          }}
        >
          <div class="relative flex h-[90vh] w-[95vw] items-center justify-center">
            <img
              class="max-h-full max-w-full object-contain"
              src={`/api/assets/${encodeURIComponent(lightboxImage.output.id)}`}
              alt={`Expanded generated image for ${lightboxImage.job.modelName}`}
            />
            <button
              class="btn btn-circle btn-sm absolute top-2 right-2"
              type="button"
              onClick={() => setLightboxId(null)}
              aria-label="Close image"
            >
              ×
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}

function GalleryItem({
  job,
  run,
  output,
  actionsBusy,
  busy,
  revealed,
  onReveal,
  onOpen,
  onCancel,
  onDelete,
}: {
  job: Job;
  run: Run;
  output: Output | undefined;
  actionsBusy: boolean;
  busy: boolean;
  revealed: boolean;
  onReveal: () => void;
  onOpen: (assetId: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const aspectRatio = run.options.aspectRatio.replace(":", " / ");
  const itemId = output?.id ?? job.id;

  return (
    <figure
      class="group bg-base-300 relative w-[calc(50%_-_0.25rem)] overflow-hidden rounded-box outline-offset-2 focus-within:outline-2 focus-within:outline-primary sm:w-[calc(33.333333%_-_0.333333rem)] lg:w-[calc(25%_-_0.75rem)]"
      style={output ? undefined : { aspectRatio }}
    >
      {output ? (
        <button
          class="block w-full cursor-zoom-in text-left"
          type="button"
          onClick={(event) => {
            if (
              event.detail !== 0 &&
              !window.matchMedia("(hover: hover)").matches &&
              !revealed
            ) {
              onReveal();
              return;
            }
            onOpen(output.id);
          }}
          aria-expanded={revealed}
          aria-controls={`gallery-details-${itemId}`}
          aria-label={`Open generated image for ${job.modelName}`}
        >
          <img
            class="block h-auto w-full transition duration-300 group-hover:scale-105"
            loading="lazy"
            src={`/api/assets/${encodeURIComponent(output.id)}`}
            alt={`Generated image for ${job.modelName}`}
          />
        </button>
      ) : (
        <button
          class="text-base-content/35 flex h-full w-full items-center justify-center"
          type="button"
          onClick={onReveal}
          aria-expanded={revealed}
          aria-controls={`gallery-details-${itemId}`}
          aria-label={`Show ${job.status === "running" ? "generating" : "queued"} image details`}
        >
          {job.status === "running" ? (
            <span class="loading loading-spinner loading-md" />
          ) : (
            <span class="status status-warning status-lg" />
          )}
          <span class="sr-only">
            {job.status === "running" ? "Generating image" : "Image queued"}
          </span>
        </button>
      )}

      <div
        class={`pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/80 via-black/10 to-black/90 p-2.5 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 ${revealed ? "opacity-100" : ""}`}
        id={`gallery-details-${itemId}`}
      >
        <div
          class={`pointer-events-none flex justify-end gap-1.5 group-hover:pointer-events-auto group-focus-within:pointer-events-auto ${revealed ? "pointer-events-auto" : ""}`}
        >
          {output ? (
            <>
              <a
                class="btn btn-xs btn-square border-white/20 bg-black/65 text-white hover:bg-black"
                href={`/api/assets/${encodeURIComponent(output.id)}`}
                download={downloadFilename(job, output)}
                aria-label={`Download image from ${job.modelName}`}
              >
                <DownloadIcon />
              </a>
              <button
                class="btn btn-xs btn-square border-white/20 bg-black/65 text-white hover:bg-black"
                type="button"
                disabled={actionsBusy}
                onClick={onDelete}
                aria-label={`Delete image from ${job.modelName}`}
              >
                {busy ? (
                  <span class="loading loading-spinner loading-xs" />
                ) : (
                  <TrashIcon />
                )}
              </button>
            </>
          ) : job.status === "queued" ? (
            <button
              class="btn btn-xs border-white/20 bg-black/65 text-white hover:bg-black"
              type="button"
              disabled={actionsBusy}
              onClick={onCancel}
            >
              {busy && <span class="loading loading-spinner loading-xs" />}
              {busy ? "Cancelling..." : "Cancel"}
            </button>
          ) : null}
        </div>

        <figcaption class="text-xs drop-shadow">
          <p class="truncate font-semibold" title={job.modelName}>
            {job.modelName}
          </p>
          <p class="truncate text-white/70" title={job.modelId}>
            {job.providerId} / {job.modelId}
          </p>
          <p class="mt-1 text-white/80">
            {run.options.resolution} · {run.options.aspectRatio} ·{" "}
            {output
              ? formatCost(job)
              : job.status === "running"
                ? "Generating"
                : "Queued"}
          </p>
          <time class="text-white/60" dateTime={job.createdAt}>
            {formatDate(job.createdAt)}
          </time>
        </figcaption>
      </div>
    </figure>
  );
}

function formatCost(job: Job) {
  if (job.status === "queued" || job.status === "running")
    return "Cost pending";
  if (job.costMicrousd === null) return "Cost unknown";
  const cost = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(job.costMicrousd / 1_000_000);
  return job.costComplete ? cost : `${cost} known`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function downloadFilename(job: Job, output: Output) {
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[output.mimeType];
  const model = job.modelName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const createdAt = new Date(output.createdAt);
  const stamp = [
    String(createdAt.getUTCFullYear()).slice(-2),
    String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
    String(createdAt.getUTCDate()).padStart(2, "0"),
    "-",
    String(createdAt.getUTCHours()).padStart(2, "0"),
    String(createdAt.getUTCMinutes()).padStart(2, "0"),
    String(createdAt.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  return `pictogen-${stamp}-${model || "image"}.${extension ?? "png"}`;
}

function DownloadIcon() {
  return (
    <svg
      class="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      class="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
    >
      <path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m3 0-1 14H7L6 7" />
    </svg>
  );
}
