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
    alias(libs.plugins.ksp) apply false
}

// ---------------------------------------------------------------------------
// Module graph rules (design doc §10.2), checked on every build:
//  - :core:*     never depends on :obliance:*, :feature:* or any app;
//  - :feature:*  depends on :core:* only;
//  - :obliance:api and :obliance:domain depend on :core:* only;
//  - :obliance:data (plumbing) depends on :core:*, :obliance:api, :obliance:domain;
//  - Obliance screen modules (:obliance:access, :triage, :devices, :fleet,
//    :more, and any later one) depend on :core:* and the plumbing only: they
//    never reference each other, :obliance:app or the WebView :app;
//  - :obliance:app is THE application: it assembles the screen modules and
//    may depend on every :core:* and :obliance:* module (never on :app).
// ---------------------------------------------------------------------------
val obliancePlumbing = setOf(":obliance:api", ":obliance:domain", ":obliance:data")
val oblianceApp = ":obliance:app"

fun graphViolation(from: String, to: String): String? = when {
    from.startsWith(":core:") && !to.startsWith(":core:") -> "platform module $from must not depend on $to"
    from.startsWith(":feature:") && !to.startsWith(":core:") -> "feature module $from may only depend on :core:*, not $to"
    to == ":app" || to == oblianceApp -> "$from must not depend on the application module $to"
    (from == ":obliance:api" || from == ":obliance:domain") && !to.startsWith(":core:") ->
        "$from may only depend on :core:*, not $to"
    from == ":obliance:data" && to.startsWith(":obliance:") && to !in obliancePlumbing ->
        "$from must not depend on the screen module $to"
    from == oblianceApp -> null
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
