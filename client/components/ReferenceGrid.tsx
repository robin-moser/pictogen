import { useRef, useState } from "preact/hooks";
import { uploadReference } from "../api.js";
import type {
  Asset,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";

type Props = {
  session: SessionDetail;
  draft: SessionDraft;
  onReferenceUploaded: (asset: Asset) => void;
  onReferenceRemoved: (assetId: string) => Promise<boolean>;
};

export function ReferenceGrid({
  session,
  draft,
  onReferenceUploaded,
  onReferenceRemoved,
}: Props) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const references = draft.referenceAssetIds
    .map((id) => session.references.find((reference) => reference.id === id))
    .filter((reference): reference is Asset => Boolean(reference));
  const slots = Math.max(3, references.length + 1);

  async function addFiles(files: FileList | File[]) {
    if (uploading || !files[0]) return;
    if (draft.referenceAssetIds.length >= 20) {
      setUploadError("A draft can include at most 20 reference images.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      onReferenceUploaded(await uploadReference(session.id, files[0]));
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "The reference could not be uploaded.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section aria-labelledby="references-heading">
      <h2 id="references-heading" class="sr-only">
        Reference images
      </h2>
      <div
        tabindex={0}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void addFiles(event.dataTransfer?.files ?? []);
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length) {
            event.preventDefault();
            void addFiles(files);
          }
        }}
      >
        <input
          ref={fileInputRef}
          class="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => void addFiles(event.currentTarget.files ?? [])}
        />
        <ul class="flex gap-2 overflow-x-auto pb-1 lg:h-80 lg:grid lg:grid-rows-3 lg:gap-4 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1 lg:pb-0">
          {Array.from({ length: slots }, (_, index) => {
            const reference = references[index];
            return (
              <li
                key={reference?.id ?? `placeholder-${index}`}
                class="relative size-24 shrink-0 overflow-hidden rounded-box lg:h-auto lg:w-full"
              >
                {reference ? (
                  <div class="border-base-content/30 relative size-full overflow-hidden rounded-box border-2 bg-base-100 shadow-sm">
                    <img
                      class="size-full rounded-box object-cover"
                      src={`/api/assets/${encodeURIComponent(reference.id)}`}
                      alt={`Reference image ${index + 1}`}
                    />
                    <button
                      class="btn btn-error btn-xs btn-square absolute top-2 right-2 shadow-sm"
                      type="button"
                      aria-label={`Remove reference image ${index + 1}`}
                      onClick={() => void onReferenceRemoved(reference.id)}
                    >
                      ×
                    </button>
                  </div>
                ) : index === references.length ? (
                  <button
                    class="border-base-content/30 text-base-content/50 hover:border-base-content/35 hover:text-base-content flex size-full flex-col items-center justify-center gap-1 rounded-box border-2 border-dashed bg-base-100 text-xs shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    type="button"
                    disabled={uploading || draft.referenceAssetIds.length >= 20}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <span
                        class="loading loading-spinner loading-sm"
                        aria-label="Uploading reference image"
                      />
                    ) : (
                      <>
                        <span class="text-lg leading-none" aria-hidden="true">
                          +
                        </span>
                        <span>Add</span>
                      </>
                    )}{" "}
                  </button>
                ) : (
                  <div
                    class="size-full rounded-box bg-base-300/60"
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {uploadError && <p class="text-error mt-2 text-xs">{uploadError}</p>}
    </section>
  );
}
