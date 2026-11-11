# R8 keep rules for the release build. Add a -keep rule here for any class a library reaches
# by reflection (for example JSON models parsed by a reflection-based library).

# Phone abilities (com.anyapp.abilities): Android creates the action runner by its name in the manifest.
-keep class * implements com.anyapp.abilities.ActionRunner { <init>(); }
