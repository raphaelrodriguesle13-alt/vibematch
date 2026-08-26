plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

fun String.toBuildConfigString(): String =
    "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""

val releaseBuildRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}

android {
    namespace = "com.vibematch.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vibematch.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            val debugApiBaseUrl = providers.gradleProperty("API_BASE_URL")
                .orElse("http://10.0.2.2:3000")
                .get()
            val debugGoogleClientId = providers.gradleProperty("GOOGLE_SERVER_CLIENT_ID")
                .orElse("")
                .get()
            val debugLiveKitUrl = providers.gradleProperty("LIVEKIT_URL")
                .orElse("")
                .get()
            buildConfigField("String", "API_BASE_URL", debugApiBaseUrl.toBuildConfigString())
            buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", debugGoogleClientId.toBuildConfigString())
            buildConfigField("String", "LIVEKIT_URL", debugLiveKitUrl.toBuildConfigString())
        }
        release {
            val releaseApiBaseUrl = providers.gradleProperty("API_BASE_URL")
                .orElse("https://api.vibematch.example")
                .get()
            val releaseGoogleClientId = providers.gradleProperty("GOOGLE_SERVER_CLIENT_ID")
                .orElse("MISSING_GOOGLE_SERVER_CLIENT_ID")
                .get()
            val releaseLiveKitUrl = providers.gradleProperty("LIVEKIT_URL")
                .orElse("MISSING_LIVEKIT_URL")
                .get()
            require(releaseApiBaseUrl.startsWith("https://")) {
                "Release API_BASE_URL must use HTTPS"
            }
            if (releaseBuildRequested) {
                require(releaseGoogleClientId != "MISSING_GOOGLE_SERVER_CLIENT_ID") {
                    "Release GOOGLE_SERVER_CLIENT_ID must be configured"
                }
                require(releaseLiveKitUrl.startsWith("wss://")) {
                    "Release LIVEKIT_URL must use wss://"
                }
            }
            buildConfigField("String", "API_BASE_URL", releaseApiBaseUrl.toBuildConfigString())
            buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", releaseGoogleClientId.toBuildConfigString())
            buildConfigField("String", "LIVEKIT_URL", releaseLiveKitUrl.toBuildConfigString())
            isDebuggable = false
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.01.00")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.security:security-crypto:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.livekit:livekit-android:2.28.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
