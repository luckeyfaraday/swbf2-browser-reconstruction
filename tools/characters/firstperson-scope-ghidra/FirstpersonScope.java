// Bounded static weapon investigation; no global analysis or game execution.
// @category BF2.Weapons
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import java.nio.file.Files;
import java.nio.file.Path;

public class FirstpersonScope extends GhidraScript {
    public void run() throws Exception {
        String[] args = getScriptArgs();
        Path output = Path.of(args[0]);
        Files.createDirectories(output);
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        try {
            for (int index = 1; index < args.length; index++) {
                String[] range = args[index].split(":");
                Address entry = toAddr(range[0]);
                disassemble(entry);
                Function function = getFunctionAt(entry);
                if (function == null) function = createFunction(entry, "Scope_" + entry.toString());
                if (function == null) throw new IllegalStateException("No function at " + entry);
                AddressSet listingBody = range.length == 2 ? new AddressSet(entry, toAddr(range[1]).subtract(1)) : new AddressSet(function.getBody());
                disassemble(entry);
                decompiler.flushCache();
                DecompileResults result = decompiler.decompileFunction(function, 45, monitor);
                StringBuilder text = new StringBuilder();
                text.append("// Input: ").append(currentProgram.getExecutablePath()).append("\n");
                text.append("// Address: ").append(entry).append("\n");
                text.append("// Bounded disassembly; no global auto-analysis or target execution.\n");
                text.append("// Error: ").append(result.getErrorMessage()).append("\n");
                if (result.decompileCompleted()) text.append(result.getDecompiledFunction().getC());
                text.append("\n/* Instructions:\n");
                for (Instruction instruction : currentProgram.getListing().getInstructions(listingBody, true)) {
                    text.append(instruction.getAddress()).append("  ").append(instruction).append("\n");
                }
                text.append("*/\n");
                Files.writeString(output.resolve(entry.toString() + ".c"), text.toString());
                println("Projectile function " + entry + " bytes=" + function.getBody().getNumAddresses() +
                    " decompiled=" + result.decompileCompleted());
            }
        } finally { decompiler.dispose(); }
    }
}
