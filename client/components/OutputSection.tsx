import type { SessionDetail } from "../../shared/contracts.js";
export function OutputSection({ session }: { session: SessionDetail }) {
  if (!session.runs.length) return null;
  return (
    <section class="py-5">
      <div class="mx-auto max-w-6xl">
        <div class="mt-4 grid gap-5">
          {session.runs.map((run) => (
            <article
              key={run.id}
              class="border-base-300 rounded-box border bg-base-100 p-4 shadow-sm"
            >
              <p class="text-base-content/60 text-sm whitespace-pre-wrap">
                {run.prompt}
              </p>
              <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {run.jobs.map((job) => (
                  <section key={job.id} class="bg-base-200/40 p-3">
                    <div class="flex justify-between gap-2 text-sm">
                      <strong>{job.modelName}</strong>
                      <span>{job.status}</span>
                    </div>
                    {job.errorMessage && (
                      <p class="text-error mt-2 text-xs">{job.errorMessage}</p>
                    )}
                    {job.outputs.length > 0 && (
                      <div class="mt-3 grid grid-cols-2 gap-2">
                        {job.outputs.map((output, index) => (
                          <img
                            key={output.id}
                            class="bg-base-300 aspect-square w-full object-cover"
                            loading="lazy"
                            src={`/api/assets/${encodeURIComponent(output.id)}`}
                            alt={`Generated image ${index + 1} for ${job.modelName}`}
                          />
                        ))}
                      </div>
                    )}
                    {(job.status === "queued" || job.status === "running") && (
                      <p class="text-base-content/60 mt-3 text-xs">
                        {job.completedCount} / {job.requestedCount} images
                        complete
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
