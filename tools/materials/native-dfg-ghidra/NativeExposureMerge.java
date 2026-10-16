// Merge one previously bounded unwind fragment into its proven full function.
// @category BF2.Rendering
import ghidra.app.script.GhidraScript;
public class NativeExposureMerge extends GhidraScript {
    public void run() throws Exception {
        var fragment = getFunctionAt(toAddr("0x140ff2960"));
        if (fragment != null) {
            if (fragment.getBody().getMaxAddress().compareTo(toAddr("0x140ff2b65")) >= 0)
                throw new IllegalStateException("Unexpected fragment extent");
            removeFunction(fragment);
        }
        runScript("NativeDfgFunctions.java", getScriptArgs());
    }
}
