// Root build script: declares the plugins used by the modules.
// AGP 9 ships Kotlin itself ("built-in Kotlin"): org.jetbrains.kotlin.android
// must NOT be applied anywhere in this project. Pure JVM modules use
// org.jetbrains.kotlin.jvm at the same Kotlin version.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

// ---------------------------------------------------------------------------
// Module graph rules (design doc §10.2), checked on every build:
//  - :core:*     never depends on :obliance:*, :feature:* or :app;
//  - :feature:*  depends on :core:* only;
//  - :obliance:* never depends on :app, and screen modules do not reference
//    each other (only :obliance:api, :obliance:domain, :obliance:data).
// ---------------------------------------------------------------------------
val obliancePlumbing = setOf(":obliance:api", ":obliance:domain", ":obliance:data")

fun graphViolation(from: String, to: String): String? = when {
    from.startsWith(":core:") && !to.startsWith(":core:") -> "platform module $from must not depend on $to"
    from.startsWith(":feature:") && !to.startsWith(":core:") -> "feature module $from may only depend on :core:*, not $to"
    from.startsWith(":obliance:") && to == ":app" -> "$from must not depend on :app"
    from.startsWith(":obliance:") && to.startsWith(":obliance:") && from !in obliancePlumbing && to !in obliancePlumbing ->
        "Obliance screen modules must not reference each other ($from -> $to)"
    else -> null
}

subprojects {
    afterEvaluate {
        val problems = configurations.flatMap { conf ->
            conf.dependencies.withType<ProjectDependency>().mapNotNull { graphViolation(path, it.path) }
        }.distinct()
        if (problems.isNotEmpty()) throw GradleException("Module graph violation:\n  " + problems.joinToString("\n  "))
    }
}
