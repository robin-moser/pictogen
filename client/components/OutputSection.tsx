import type { SessionDetail } from "../../shared/contracts.js";
import { useState } from "preact/hooks";

export function OutputSection({ session }: { session: SessionDetail }) {
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  if (!session.runs.length) return null;

  const outputs = session.runs.flatMap((run) =>
    run.jobs
      .filter((job) => job.status !== "failed")
      .flatMap((job) =>
        Array.from({ length: job.requestedCount }, (_, index) => ({
          output: job.outputs[index],
          job,
          options: run.options,
        })),
      ),
  );

  const lightboxImage = outputs.find(({ output }) => output?.id === lightboxId);

  return (
    <section class="py-5">
      <div class="mx-auto max-w-6xl">
        <div class="columns-2 gap-2 sm:columns-3 lg:columns-4">
          {outputs.map(({ output, job, options }, index) => (
            <figure
              key={output?.id ?? `${job.id}-placeholder-${index}`}
              class="group bg-base-300 relative mb-2 w-full break-inside-avoid overflow-hidden outline-offset-2 focus-within:outline-2 focus-within:outline-primary"
              style={{ aspectRatio: options.aspectRatio.replace(":", " / ") }}
            >
              {output ? (
                <button
                  class="block h-full w-full cursor-zoom-in text-left"
                  type="button"
                  onClick={() => setLightboxId(output.id)}
                  aria-label={`Open generated image for ${job.modelName}`}
                >
                  <img
                    class="h-full w-full object-contain transition duration-300 group-hover:scale-105"
                    loading="lazy"
                    src={`/api/assets/${encodeURIComponent(output.id)}`}
                    alt={`Generated image for ${job.modelName}`}
                  />
                  <Metadata job={job} options={options} />
                </button>
              ) : (
                <div class="flex h-full items-center justify-center">
                  <span class="loading loading-spinner text-base-content/40" />
                  <Metadata job={job} options={options} />
                </div>
              )}
            </figure>
          ))}
        </div>
      </div>
      {lightboxImage?.output && (
        <dialog
          open
          class="modal modal-open bg-black/80 p-4"
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

function Metadata({
  job,
  options,
}: {
  job: SessionDetail["runs"][number]["jobs"][number];
  options: SessionDetail["runs"][number]["options"];
}) {
  return (
    <div class="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/85 via-black/25 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
      <div class="flex flex-wrap gap-1.5 text-xs font-medium text-white">
        <span class="rounded bg-black/75 px-2 py-1">{job.modelName}</span>
        <span class="rounded bg-black/75 px-2 py-1">{options.resolution}</span>
        <span class="rounded bg-black/75 px-2 py-1">{options.aspectRatio}</span>
        <span class="rounded bg-black/75 px-2 py-1">
          {job.costMicrousd === null
            ? "Cost pending"
            : `~$${(job.costMicrousd / 1_000_000).toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}
