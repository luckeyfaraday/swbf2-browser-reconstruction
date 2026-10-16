// Remove only the previously created mid-function fragment before bounded recovery.
import ghidra.app.script.GhidraScript;
public class NativeDirectRemovePartial extends GhidraScript {
  public void run() throws Exception {
    var function = getFunctionAt(toAddr("140fcb090"));
    if (function != null) removeFunction(function);
  }
}
