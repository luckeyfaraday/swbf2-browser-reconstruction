// Remove one mistaken entry from the owned analysis database, never target bytes.
import ghidra.app.script.GhidraScript;
public class NativeDirectRemoveMisaligned extends GhidraScript {
  public void run() throws Exception {
    var function = getFunctionAt(toAddr("140d87b30"));
    if (function != null) removeFunction(function);
  }
}
