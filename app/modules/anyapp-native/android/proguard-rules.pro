# The Go tailcat bridge calls back into Java over JNI (InterfaceLister, Seq): R8 must not
# rename or drop these classes, or release builds break (docs/EASY-CONNECT.md 4.2).
-keep class go.** { *; }
-keep class dev.anyappagent.tailcatbridge.** { *; }
-keep class com.anyappagent.nativebridge.EasyConnectInterfaces { *; }
