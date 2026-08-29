import { useRef, useState } from "preact/hooks";
import { uploadReference } from "../api.js";
import type {
  Asset,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";
import { CloseIcon, ImageIcon, PlusIcon } from "./Icons.js";

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
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const references = draft.referenceAssetIds
    .map((id) => session.references.find((reference) => reference.id === id))
    .filter((reference): reference is Asset => Boolean(reference));
  const full = draft.referenceAssetIds.length >= 20;

  async function addFiles(files: FileList | File[]) {
    if (uploading || !files[0]) return;
    if (full) {
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
    <section
      class="border-base-300 border-b"
      aria-labelledby="references-heading"
    >
      <h2 id="references-heading" class="sr-only">
        Reference images
      </h2>
      <div
        class={`flex items-center gap-2 px-3 py-2.5 transition-colors ${
          dragging ? "bg-primary/10" : ""
        }`}
        tabindex={0}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
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

        <span
          class="text-base-content/35 flex shrink-0 items-center gap-1.5 pr-1"
          title="Reference images"
        >
          <ImageIcon class="size-4" />
          <span class="text-[0.7rem] font-medium tabular-nums">
            {references.length}
          </span>
        </span>

        <ul class="flex min-w-0 grow items-center gap-1.5 overflow-x-auto">
          {references.map((reference, index) => (
            <li key={reference.id} class="group/ref relative shrink-0">
              <img
                class="border-base-300 rounded-field size-12 border object-cover"
                src={`/api/assets/${encodeURIComponent(reference.id)}`}
                alt={`Reference image ${index + 1}`}
              />
              <button
                class="bg-base-100 border-base-300 text-base-content/70 hover:bg-error hover:text-error-content absolute -top-1 -right-1 grid size-4 place-items-center rounded-full border opacity-0 transition group-focus-within/ref:opacity-100 group-hover/ref:opacity-100 max-md:opacity-100"
                type="button"
                aria-label={`Remove reference image ${index + 1}`}
                onClick={() => void onReferenceRemoved(reference.id)}
              >
                <CloseIcon class="size-2.5" />
              </button>
            </li>
          ))}

          <li class="shrink-0">
            <button
              class="border-base-300 text-base-content/40 hover:border-primary/60 hover:text-primary rounded-field grid size-12 place-items-center border border-dashed transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={uploading || full}
              title={full ? "Reference limit reached" : "Add reference image"}
              aria-label="Add reference image"
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <span class="loading loading-spinner loading-xs" />
              ) : (
                <PlusIcon class="size-4" />
              )}
            </button>
          </li>
        </ul>

        {references.length === 0 && !uploading && (
          <span class="text-base-content/30 hidden shrink-0 pr-1 text-xs sm:block">
            Drop, paste or click to add references
          </span>
        )}
      </div>

      {uploadError && <p class="text-error px-3 pb-2 text-xs">{uploadError}</p>}
    </section>
  );
}
