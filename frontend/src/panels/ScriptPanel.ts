import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import type { WSClient } from "../ws/WSClient.js";

const DEFAULT_SCRIPT = `// defi-ctf player script
// Available: onBlock, onPriceBelow, onPriceAbove, swap, wrapEth, unwrapEth,
//            getBalance, getPrice, getPriceHistory, parseEther, formatEther, log

const PAIR = "weth-usdc-uniswap";
const BUY_BELOW  = 2800;   // buy WETH when price drops below this
const SELL_ABOVE = 3200;   // sell WETH when price rises above this

let hasBought = false;

onPriceBelow(PAIR, BUY_BELOW, async (ctx) => {
  if (hasBought) return;
  const usdcBal = await getBalance("USDC");
  if (usdcBal < parseUnits("100", 6)) return;

  const amountIn = usdcBal / 2n;
  await swap(PAIR, "USDC", amountIn);
  hasBought = true;
  log(\`[Block \${ctx.blockNumber}] Bought WETH @ \${ctx.price.toFixed(2)}\`);
});

onPriceAbove(PAIR, SELL_ABOVE, async (ctx) => {
  if (!hasBought) return;
  const wethBal = await getBalance("WETH");
  if (wethBal === 0n) return;

  await swap(PAIR, "WETH", wethBal);
  hasBought = false;
  log(\`[Block \${ctx.blockNumber}] Sold WETH @ \${ctx.price.toFixed(2)}\`);
});
`;

export class ScriptPanel {
  private view: EditorView;
  private ws:   WSClient;

  constructor(container: HTMLElement, ws: WSClient) {
    this.ws = ws;

    const header = document.createElement("div");
    header.className = "panel-section";
    header.innerHTML = `
      <div class="panel-title">SCRIPT EDITOR</div>
      <div class="btn-row">
        <button id="btn-run-script" class="btn btn-primary">Run Script</button>
        <button id="btn-stop-script" class="btn btn-danger">Stop</button>
      </div>
    `;
    container.appendChild(header);

    const editorDiv = document.createElement("div");
    editorDiv.className = "editor-wrap";
    container.appendChild(editorDiv);

    const state = EditorState.create({
      doc: DEFAULT_SCRIPT,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        javascript(),
        oneDark,
        keymap.of(defaultKeymap),
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px", fontFamily: "monospace" },
          ".cm-scroller": { overflow: "auto" },
        }),
      ],
    });

    this.view = new EditorView({ state, parent: editorDiv });

    header.querySelector("#btn-run-script")!.addEventListener("click", () => {
      const source = this.view.state.doc.toString();
      ws.send("script_run", { source });
    });

    header.querySelector("#btn-stop-script")!.addEventListener("click", () => {
      ws.send("script_stop", {});
    });
  }
}
