import { CordisKernel } from "../src/index.js";
import { describeKernel } from "./kernel-suite.js";

describeKernel("Cordis 内核原型", () => new CordisKernel());
