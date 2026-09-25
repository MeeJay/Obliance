import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Remote-session tunnel of the platform (design doc §10.9): the browser end of
// /api/remote/tunnel/<token> over the shared OkHttp stack. Pure JVM, no
// Obliance type (the protocol is the platform's relay, not an app feature).
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    api(libs.okhttp)
    api(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
}
