import { MasonryGrid } from "@egjs/grid";
import { useEffect, useRef, useState } from "preact/hooks";

import type { SessionDetail } from "../../shared/contracts.js";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  ExpandIcon,
  GridIcon,
  ImagePlusIcon,
  RestoreIcon,
  RestoreSizeIcon,
  TrashIcon,
} from "./Icons.js";

type Job = SessionDetail["runs"][number]["jobs"][number];
type Run = SessionDetail["runs"][number];
type Output = Job["outputs"][number];

type Props = {
  session: SessionDetail;
  columns: number;
  onColumnsChange: (columns: number) => void;
  busyItemId: string | null;
  onCancelJob: (jobId: string) => void;
  onDeleteOutput: (assetId: string) => void;
  onRestoreOutput: (run: Run, job: Job) => void;
  onAddOutputReference: (assetId: string) => void;
  onDismissJob: (jobId: string) => void;
  onClearGenerationLog: () => void;
  outputExpanded: boolean;
  onToggleOutputExpanded: () => void;
};

export function OutputSection({
  session,
  columns,
  onColumnsChange,
  busyItemId,
  onCancelJob,
  onDeleteOutput,
  onRestoreOutput,
  onAddOutputReference,
  onDismissJob,
  onClearGenerationLog,
  outputExpanded,
  onToggleOutputExpanded,
}: Props) {
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [lightboxControlsVisible, setLightboxControlsVisible] = useState(true);
  const [revealedItemId, setRevealedItemId] = useState<string | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  const jobs = session.runs.flatMap((run) =>
    run.jobs.map((job) => ({ job, run })),
  );
  const failures = jobs.filter(({ job }) => job.status === "failed");
  const galleryItems = jobs.flatMap(({ job, run }) => {
    if (job.status === "failed" || job.status === "cancelled") {
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
  const lightboxItems = galleryItems.flatMap(({ job, run, output }) =>
    output ? [{ job, run, output }] : [],
  );
  const lightboxIndex = lightboxItems.findIndex(
    ({ output }) => output.id === lightboxId,
  );
  const lightboxImage = lightboxItems[lightboxIndex];
  const actionsBusy = busyItemId !== null;
  const galleryKey = galleryItems
    .map(({ job, output }) => output?.id ?? job.id)
    .join(":");
  const lightboxKey = lightboxItems.map(({ output }) => output.id).join(":");

  useEffect(() => {
    const element = galleryRef.current;
    if (!element || !galleryKey) return;

    const small = window.matchMedia("(min-width: 40rem)");
    const large = window.matchMedia("(min-width: 64rem)");
    const grid = new MasonryGrid(element, {
      align: "stretch",
      column: columns,
      gap: large.matches ? 12 : 8,
      useResizeObserver: true,
      observeChildren: true,
    });
    const updateLayout = () => {
      grid.gap = large.matches ? 12 : 8;
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
  }, [columns, galleryKey]);

  function step(direction: number) {
    if (!lightboxItems.length) return;
    const nextIndex =
      (lightboxIndex + direction + lightboxItems.length) % lightboxItems.length;
    const nextImage = lightboxItems[nextIndex];
    if (nextImage) {
      setLightboxId(nextImage.output.id);
      setLightboxControlsVisible(true);
    }
  }

  function openLightbox(assetId: string) {
    setLightboxId(assetId);
    setLightboxControlsVisible(true);
  }

  useEffect(() => {
    if (!lightboxImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxId(null);
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      step(event.key === "ArrowRight" ? 1 : -1);
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxImage, lightboxIndex, lightboxKey]);

  if (!session.runs.length)
    return (
      <p class="text-base-content/25 py-10 text-center text-xs">
        No images yet.
      </p>
    );

  return (
    <section class="pt-3" aria-labelledby="gallery-heading">
      <div class="mb-2.5 flex items-center gap-3">
        <h2 id="gallery-heading" class="field-legend flex items-center gap-1.5">
          Gallery
          <span class="text-base-content/30 tabular-nums">
            {lightboxItems.length}
          </span>
        </h2>

        <label
          class="text-base-content/35 hover:text-base-content/60 ml-auto flex items-center gap-2 transition-colors"
          title="Images per line"
        >
          <GridIcon class="size-3.5" />
          <span class="sr-only">Images per line</span>
          <input
            class="range range-xs w-20"
            type="range"
            min="1"
            max="6"
            step="1"
            value={columns}
            onInput={(event) =>
              onColumnsChange(Number(event.currentTarget.value))
            }
          />
          <span class="w-2 text-[0.7rem] tabular-nums">{columns}</span>
        </label>
        <button
          class="btn btn-ghost btn-xs btn-square"
          type="button"
          aria-label={
            outputExpanded ? "Show prompt and settings" : "Expand output"
          }
          aria-pressed={outputExpanded}
          title={outputExpanded ? "Show prompt and settings" : "Expand output"}
          onClick={onToggleOutputExpanded}
        >
          {outputExpanded ? (
            <RestoreSizeIcon class="size-3.5" />
          ) : (
            <ExpandIcon class="size-3.5" />
          )}
        </button>
      </div>

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
              onOpen={openLightbox}
              onCancel={() => onCancelJob(job.id)}
              onDelete={() => output && onDeleteOutput(output.id)}
              onRestore={() => onRestoreOutput(run, job)}
              onAddReference={() => output && onAddOutputReference(output.id)}
            />
          ))}
        </div>
      )}

      {failures.length > 0 && (
        <details class="border-base-300 bg-base-200 rounded-box mt-3 border">
          <summary class="text-base-content/60 hover:text-base-content flex cursor-pointer items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors">
            Generation log
            <span class="badge badge-error badge-xs">{failures.length}</span>
            <button
              class="btn btn-ghost btn-xs ml-auto"
              type="button"
              disabled={actionsBusy}
              onClick={(event) => {
                event.preventDefault();
                onClearGenerationLog();
              }}
            >
              {busyItemId === session.id ? "Deleting…" : "Clear"}
            </button>
          </summary>
          <ul class="divide-base-300 border-base-300 divide-y border-t">
            {failures.map(({ job }) => (
              <li key={job.id} class="flex items-start gap-3 px-3 py-2.5">
                <div class="min-w-0 grow">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-medium">{job.modelName}</span>
                    <span class="badge badge-error badge-xs">Failed</span>
                  </div>
                  <p class="text-base-content/40 mt-0.5 truncate text-[0.68rem]">
                    {job.providerId} / {job.modelId} ·{" "}
                    {formatEffectiveOptions(job)} · {formatDate(job.createdAt)}
                  </p>
                  <p class="text-error mt-1 text-xs">
                    {job.errorMessage ?? "Generation failed."}
                  </p>
                </div>
                <button
                  class="btn btn-ghost btn-xs btn-square shrink-0"
                  type="button"
                  disabled={actionsBusy}
                  onClick={() => onDismissJob(job.id)}
                  aria-label={`Delete ${job.modelName} log entry`}
                >
                  {busyItemId === job.id ? (
                    <span class="loading loading-spinner loading-xs" />
                  ) : (
                    <TrashIcon class="size-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {lightboxImage && (
        <dialog
          open
          class="modal modal-open bg-black/85"
          aria-label={`Generated image from ${lightboxImage.job.modelName}`}
          onClick={() => setLightboxId(null)}
        >
          <div class="relative flex h-dvh w-screen items-center justify-center p-4">
            <div
              class="relative max-h-full max-w-full"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                class="block cursor-pointer"
                type="button"
                aria-label={`${lightboxControlsVisible ? "Hide" : "Show"} image information and controls`}
                onClick={() =>
                  setLightboxControlsVisible((visible) => !visible)
                }
              >
                <img
                  class="block max-h-[88vh] max-w-[92vw] object-contain"
                  src={`/api/assets/${encodeURIComponent(lightboxImage.output.id)}`}
                  alt={`Expanded generated image for ${lightboxImage.job.modelName}`}
                />
              </button>
              {lightboxControlsVisible && (
                <>
                  <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-4 pt-14 pb-4 text-white">
                    <p class="line-clamp-3 text-sm leading-relaxed">
                      {lightboxImage.run.prompt}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-white/60">
                      <span class="text-white/85">
                        {lightboxImage.job.modelName}
                      </span>
                      <span>
                        {lightboxImage.job.providerId} /{" "}
                        {lightboxImage.job.modelId}
                      </span>
                      <span>{formatEffectiveOptions(lightboxImage.job)}</span>
                      <span>{formatCost(lightboxImage.job)}</span>
                      <time dateTime={lightboxImage.job.createdAt}>
                        {formatDate(lightboxImage.job.createdAt)}
                      </time>
                    </div>
                  </div>

                  <a
                    class="btn btn-sm btn-square absolute top-2 right-12 border-white/15 bg-black/60 text-white hover:bg-black"
                    href={`/api/assets/${encodeURIComponent(lightboxImage.output.id)}`}
                    download={downloadFilename(
                      lightboxImage.job,
                      lightboxImage.output,
                    )}
                    aria-label="Download image"
                  >
                    <DownloadIcon class="size-4" />
                  </a>
                  <button
                    class="btn btn-sm btn-square absolute top-2 right-2 border-white/15 bg-black/60 text-white hover:bg-black"
                    type="button"
                    onClick={() => setLightboxId(null)}
                    aria-label="Close image"
                  >
                    <CloseIcon class="size-4" />
                  </button>
                </>
              )}
            </div>

            {lightboxControlsVisible && lightboxItems.length > 1 && (
              <>
                <button
                  class="btn btn-sm btn-circle absolute left-3 border-white/15 bg-black/60 text-white hover:bg-black"
                  type="button"
                  aria-label="Previous image"
                  onClick={(event) => {
                    event.stopPropagation();
                    step(-1);
                  }}
                >
                  <ChevronLeftIcon class="size-4" />
                </button>
                <button
                  class="btn btn-sm btn-circle absolute right-3 border-white/15 bg-black/60 text-white hover:bg-black"
                  type="button"
                  aria-label="Next image"
                  onClick={(event) => {
                    event.stopPropagation();
                    step(1);
                  }}
                >
                  <ChevronRightIcon class="size-4" />
                </button>
              </>
            )}
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
  onRestore,
  onAddReference,
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
  onRestore: () => void;
  onAddReference: () => void;
}) {
  const aspectRatio = run.options.aspectRatio.replace(":", " / ");
  const itemId = output?.id ?? job.id;

  return (
    <figure
      class="group bg-base-200 border-base-300 focus-within:outline-primary relative overflow-hidden rounded-box border outline-offset-2 focus-within:outline-2"
      style={output ? undefined : { aspectRatio }}
    >
      {output ? (
        <button
          class="block w-full cursor-pointer text-left"
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
            class="block h-auto w-full transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            src={`/api/assets/${encodeURIComponent(output.id)}`}
            alt={`Generated image for ${job.modelName}`}
          />
        </button>
      ) : (
        <button
          class="text-base-content/30 flex h-full w-full items-center justify-center"
          type="button"
          onClick={onReveal}
          aria-expanded={revealed}
          aria-controls={`gallery-details-${itemId}`}
          aria-label={`Show ${job.status === "running" ? "generating" : "queued"} image details`}
        >
          {job.status === "running" ? (
            <span class="loading loading-spinner loading-md" />
          ) : (
            <span class="status status-warning status-md" />
          )}
          <span class="sr-only">
            {job.status === "running" ? "Generating image" : "Image queued"}
          </span>
        </button>
      )}

      <div
        class={`pointer-events-none absolute inset-0 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/85 p-2 text-white opacity-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 ${revealed ? "opacity-100" : ""}`}
        id={`gallery-details-${itemId}`}
      >
        <div
          class={`pointer-events-none flex justify-end gap-1 group-focus-within:pointer-events-auto group-hover:pointer-events-auto ${revealed ? "pointer-events-auto" : ""}`}
        >
          {output ? (
            <>
              <button
                class="btn btn-xs btn-square border-white/15 bg-black/60 text-white hover:bg-black"
                type="button"
                onClick={onRestore}
                aria-label={`Restore prompt and references from ${job.modelName}`}
                title="Restore prompt and references"
              >
                <RestoreIcon class="size-3.5" />
              </button>
              <button
                class="btn btn-xs btn-square border-white/15 bg-black/60 text-white hover:bg-black"
                type="button"
                onClick={onAddReference}
                aria-label={`Add image from ${job.modelName} to references`}
                title="Add to references"
              >
                <ImagePlusIcon class="size-3.5" />
              </button>
              <a
                class="btn btn-xs btn-square border-white/15 bg-black/60 text-white hover:bg-black"
                href={`/api/assets/${encodeURIComponent(output.id)}`}
                download={downloadFilename(job, output)}
                aria-label={`Download image from ${job.modelName}`}
              >
                <DownloadIcon class="size-3.5" />
              </a>
              <button
                class="btn btn-xs btn-square border-white/15 bg-black/60 text-white hover:bg-black"
                type="button"
                disabled={actionsBusy}
                onClick={onDelete}
                aria-label={`Delete image from ${job.modelName}`}
              >
                {busy ? (
                  <span class="loading loading-spinner loading-xs" />
                ) : (
                  <TrashIcon class="size-3.5" />
                )}
              </button>
            </>
          ) : job.status === "queued" ? (
            <button
              class="btn btn-xs border-white/15 bg-black/60 text-white hover:bg-black"
              type="button"
              disabled={actionsBusy}
              onClick={onCancel}
            >
              {busy && <span class="loading loading-spinner loading-xs" />}
              {busy ? "Cancelling…" : "Cancel"}
            </button>
          ) : null}
        </div>

        <figcaption class="text-[0.7rem] leading-4 drop-shadow">
          <p class="truncate font-semibold" title={job.modelName}>
            {job.modelName}
          </p>
          <p class="truncate text-white/60" title={job.modelId}>
            {formatEffectiveOptions(job)} ·{" "}
            {output
              ? formatCost(job)
              : job.status === "running"
                ? "Generating"
                : "Queued"}
          </p>
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

function formatEffectiveOptions(job: Job) {
  const options = job.effectiveOptions;
  return [
    options.resolution ?? "Resolution not sent",
    options.aspectRatio ?? "Aspect ratio not sent",
    options.quality,
    options.background,
    options.outputFormat?.toUpperCase(),
    options.outputCompression !== undefined
      ? `Compression ${options.outputCompression}`
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
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
    "image/svg+xml": "svg",
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
