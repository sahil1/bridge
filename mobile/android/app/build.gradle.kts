import javax.inject.Inject
import org.gradle.process.ExecOperations

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The version is Bridge AI's own, from the root package.json, so a release needs no edits here.
// versionCode is made from it (2.3.0 -> 20300), so it always goes up, as Google Play requires.
val appVersion = (groovy.json.JsonSlurper().parse(rootProject.file("../../package.json")) as Map<*, *>)["version"] as String
val appVersionCode = Regex("""^(\d+)\.(\d+)\.(\d+)""").find(appVersion)!!.destructured.let { (major, minor, patch) ->
    require(minor.toInt() < 100 && patch.toInt() < 100) { "versionCode needs minor and patch under 100 ($appVersion)" }
    major.toInt() * 10000 + minor.toInt() * 100 + patch.toInt()
}

// The upload key for Google Play stays out of the repo: its keystore and passwords come from
// ~/.gradle/gradle.properties or environment variables of the same names (mobile/android/PLAY.md).
// Without them, release builds are unsigned: that's how CI builds the APK on the website, then
// signs it with the release key itself (.github/workflows/android.yml).
val uploadNames = listOf("BRIDGE_UPLOAD_STORE_FILE", "BRIDGE_UPLOAD_STORE_PASSWORD", "BRIDGE_UPLOAD_KEY_ALIAS", "BRIDGE_UPLOAD_KEY_PASSWORD")
val upload = uploadNames.associateWith { providers.gradleProperty(it).orElse(providers.environmentVariable(it)).orNull?.takeIf(String::isNotBlank) }
val uploadMissing = upload.filterValues { it == null }.keys
val uploadStore = upload["BRIDGE_UPLOAD_STORE_FILE"]?.let { file(it.replaceFirst(Regex("^~(?=/)"), System.getProperty("user.home"))) }
if (gradle.startParameter.taskNames.any { it.contains("Release", ignoreCase = true) }) when {
    uploadMissing.size == uploadNames.size -> logger.warn("Release build is UNSIGNED: Google Play won't take it. Set ${uploadNames.joinToString()} in ~/.gradle/gradle.properties (mobile/android/PLAY.md).")
    uploadMissing.isNotEmpty() -> throw GradleException("Release signing: set ${uploadMissing.joinToString()} too (mobile/android/PLAY.md)")
    !uploadStore!!.isFile -> throw GradleException("Release signing: no keystore at $uploadStore (BRIDGE_UPLOAD_STORE_FILE)")
}

android {
    namespace = "dev.bridgeai.phone"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.bridgeai.phone"
        minSdk = 26
        // Google Play's minimum for new apps and updates since August 31, 2026 (Android 16).
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (uploadMissing.isEmpty()) create("upload") {
            storeFile = uploadStore
            storePassword = upload["BRIDGE_UPLOAD_STORE_PASSWORD"]
            keyAlias = upload["BRIDGE_UPLOAD_KEY_ALIAS"]
            keyPassword = upload["BRIDGE_UPLOAD_KEY_PASSWORD"]
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("upload")
            // Shrunk by R8. The default rules keep the @JavascriptInterface methods the page calls
            // (MainActivity.Bridge) by name.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Bridge AI's own UI, bundled in the app to run with no computer behind it: the demo (Try the demo
// on the start screen) and Cloud agents (CloudBridge). Each is built from the repo's src/ with
// `npm run <name>:build` into the app's assets, and served from
// https://appassets.androidplatform.net/assets/<name>/ (MainActivity); Cloud agents from an address
// of its own, cloud.appassets.androidplatform.net, so its storage is its own.
val bundledUis = listOf("demo", "cloud")

abstract class BuildBundledUis : DefaultTask() {
    @get:Input abstract val names: ListProperty<String>
    @get:InputFiles @get:PathSensitive(PathSensitivity.RELATIVE) abstract val sources: ConfigurableFileCollection
    @get:Internal abstract val repo: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val exec: ExecOperations

    @TaskAction
    fun build() {
        val out = outputDir.get().asFile
        out.deleteRecursively()
        // npm from your login shell, so it's found when Android Studio was opened from the Dock.
        for (name in names.get()) exec.exec {
            workingDir = repo.get().asFile
            commandLine(System.getenv("SHELL") ?: "/bin/sh", "-lic", "npm run --silent $name:build -- --outDir '${out.resolve(name)}' --logLevel warn")
        }
    }
}

androidComponents {
    onVariants { variant ->
        val task = tasks.register<BuildBundledUis>("build${variant.name.replaceFirstChar(Char::uppercase)}BundledUis") {
            val root = rootProject.layout.projectDirectory.dir("../..")
            names.set(bundledUis)
            repo.set(root)
            sources.from(root.dir("src"), root.dir("shared"), listOf("index.html", "vite.config.js", "package.json", "public/mark.svg").map(root::file))
        }
        variant.sources.assets?.addGeneratedSourceDirectory(task, BuildBundledUis::outputDir)
    }
}

dependencies {
    // Scans the pairing QR code; works without Google Play services.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    // ...which uses androidx.core without bringing it.
    implementation("androidx.core:core:1.13.1")
    // Serves the bundled UIs (the demo, Cloud agents) from the app's assets at an https address
    // (WebViewAssetLoader), and gives the Cloud agents page alone its channel to the app.
    implementation("androidx.webkit:webkit:1.14.0")
    // Cloud agents' background check, at most every 15 minutes while a key is saved (CloudCheck).
    implementation("androidx.work:work-runtime:2.10.5")
}
