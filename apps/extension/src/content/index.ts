import "./styles.css";
import { installPageInsertBridge } from "./pageBridge";
import { observeTimeline } from "./observeTimeline";
import { openPostPanel } from "./panel";
import { observePostComposers } from "./postComposerObserver";

installPageInsertBridge();
observeTimeline();
observePostComposers((button, composer) => openPostPanel(button, composer));
