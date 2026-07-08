const BRIDGE_SCRIPT_ID = "ekskomen-page-insert-bridge";
const REQUEST_EVENT = "ekskomen:page-insert-request";
const RESPONSE_EVENT = "ekskomen:page-insert-response";
const TARGET_ATTRIBUTE = "data-eks-page-target";

type InsertResponse = {
  id: string;
  ok: boolean;
  reason?: string;
};

export function installPageInsertBridge(): void {
  if (document.getElementById(BRIDGE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = BRIDGE_SCRIPT_ID;
  script.src = chrome.runtime.getURL("pageInsert.js");
  script.async = false;
  (document.head || document.documentElement).append(script);
}

export async function insertViaPageBridge(
  editable: HTMLElement,
  text: string,
): Promise<boolean> {
  const requestId = `eks-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  editable.setAttribute(TARGET_ATTRIBUTE, requestId);

  try {
    const response = await new Promise<InsertResponse>((resolve) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve({ id: requestId, ok: false, reason: "timeout" });
      }, 1200);

      const onResponse = (event: Event) => {
        const customEvent = event as CustomEvent<InsertResponse>;
        if (!customEvent.detail || customEvent.detail.id !== requestId) return;
        cleanup();
        resolve(customEvent.detail);
      };

      function cleanup(): void {
        window.clearTimeout(timeout);
        document.removeEventListener(RESPONSE_EVENT, onResponse as EventListener);
      }

      document.addEventListener(RESPONSE_EVENT, onResponse as EventListener);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: {
          id: requestId,
          targetAttribute: TARGET_ATTRIBUTE,
          text,
        },
      }));
    });

    return response.ok;
  } finally {
    editable.removeAttribute(TARGET_ATTRIBUTE);
  }
}
