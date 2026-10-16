# Selected Death Star Blast rules

`round-rules-build.py` builds `web/public/assets/round-rules.json` and
`round-rules-evidence.json` from retained installed EBX. The builder checks 32
reference/property/event links and records 89 source observations with exact JSON
pointers and file hashes. This is static installed configuration, not native
runtime observation.

The selection is explicit: `UI/Data/GameModes/Levels/CommandSectorNorth.LevelId`
names `Levels/MP/DeathStar02_01/DeathStar02_01`; its GameModes subworld includes
TeamDeathmatch for `GameMode=Blast`. TeamDeathmatch includes
`TeamDeathmatch_Online` only for `Blast`, whereas `SkirmishBlast`,
`SkirmishOnslaught` and `SkirmishDuel` use the separate Skirmish subworld. The
online logic layer references `PF_TeamDeathmatch_MP` without parent property
connections.

The selected MP interface provides `Int32 100` to both threshold inputs of
`PF_TeamDeathmatch_Logic`. Each input passes through a PropertyDefaultValue node's
`InValue` to the corresponding comparison B field. Independently,
TeamDeathmatchStateManager's IntEntity with DefaultValue 100 binds both team
KillCounter.MaxKillCount fields. The counters' serialized values of 50 are
unbound defaults and are therefore not the selected wired limit. Each counter's
Kills and KillLimit outputs feed an `A=B` comparison with property-change
triggering; those events feed the end and winner splitters. The native event
execution order and external server overrides have not been observed.

Only `runtimeOverrides.scoreLimit=100` is ready to apply. `duration` and
`respawnSeconds` remain explicitly unresolved. Their existing browser fallback
values of 600 and 3 are retained as reconstruction choices, not source results.
No selected Blast countdown-to-end wiring was established in the bounded audit;
this does **not** establish unlimited round duration. The 600 in default/settings
is named PrivateMatchNoInteractivityTimeoutTime and cannot establish round time.

The actual shared spawn graph contains HumanPlayer.PlayerKilledDelay=4,
TacticalSpawnManager.MaxWaitTime=10, MaxSpawnWaitTime=2, and interface values
5/10/0 plus an initial 2, selected through FloatHub/Math/Bool nodes. Blast is an
explicit condition in that selector graph. Both direct character-spawn objects
have SpawnDelay=0 and AutoSpawn=false; a FastSpawnManager also links to the same
SpawnManager. Spawn-wave and squad activation consult BattlepointUnitCost
`SPAWNWAVE_ENABLED` / `SQUADSPAWN_ENABLED` for `BLAST/GLOBAL`, plus debug overrides.
Thus 4, 5, 10, 2, and 0 are component settings, not an established total time from
death to controllable respawn. Native scheduling, UI acceptance, and external
spawn-mode values remain unresolved.

Other installed defaults are recorded without adding runtime overrides: both
GameModeSettings entries give Blast PlayerCount=16; the Online GameSettings
container gives Blast MinPlayersToStart=4; ServerSettings.RespawnTimeModifier=1;
SyncedGameSettings.EnableFriendlyFire=false. These defaults do not prove a live
server's configuration or imply native AI filling policy.

Rebuild and validate without running a browser:

```powershell
python tools/gameplay-recovery/round-rules-build.py
cd web
node --test test/round-rules.test.js
```

The tests verify artifact hashes/pointers, actual Blast branch selection,
bound-vs-serialized score limits and the boundary preventing spawn component
delays or private-match inactivity timeout from becoming runtime round rules.
No shared runtime files were edited.
