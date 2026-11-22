package cz.myx.petrel

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * myX Petrel – stažení ponorů z Shearwater Petrel 2 přes klasický Bluetooth (sériový port) a předání do myX.
 * Výsledek je soubor .myxbt (JSON s nativními daty ponorů), který se sdílí do webové aplikace myX.
 */
class MainActivity : Activity() {
    private val spp: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")
    private lateinit var log: TextView
    private lateinit var status: TextView
    private lateinit var go: Button
    private lateinit var devs: Spinner
    private lateinit var count: RadioGroup
    private var devices: List<BluetoothDevice> = emptyList()
    @Volatile private var stop = false
    @Volatile private var running = false
    private var socket: BluetoothSocket? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad); setBackgroundColor(Color.rgb(11, 22, 38)) }
        fun text(s: String, size: Float = 15f) = TextView(this).apply { text = s; textSize = size; setTextColor(Color.rgb(220, 230, 240)); setPadding(0, pad / 3, 0, pad / 3) }
        root.addView(text("myX Petrel", 24f))
        root.addView(text("Stažení ponorů z Petrelu 2 přes Bluetooth a předání do myX.\n1. Petrel spáruj v Nastavení → Bluetooth (PIN 0000).\n2. Na Petrelu otevři Upload log.\n3. Vyber počítač a klepni na Stáhnout. Na konci zvol aplikaci myX.", 14f))
        devs = Spinner(this)
        root.addView(devs)
        count = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        listOf("Poslední ponor", "Posledních 5 ponorů", "Všechny ponory").forEachIndexed { i, s ->
            count.addView(RadioButton(this).apply { text = s; id = 100 + i; setTextColor(Color.rgb(220, 230, 240)); isChecked = i == 0 })
        }
        root.addView(count)
        go = Button(this).apply { text = "Stáhnout"; setOnClickListener { if (running) cancel() else start() } }
        root.addView(go)
        status = text("", 16f)
        root.addView(status)
        log = text("", 11f).apply { typeface = android.graphics.Typeface.MONOSPACE; gravity = Gravity.TOP }
        root.addView(ScrollView(this).apply { addView(log) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 1)
        } else loadDevices()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) loadDevices() else status.text = "Bez povolení Bluetooth to nejde."
    }

    override fun onResume() { super.onResume(); if (!running && hasPerm()) loadDevices() }

    private fun hasPerm() = Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    private fun loadDevices() {
        val ad = getSystemService(BluetoothManager::class.java)?.adapter
        if (ad == null || !ad.isEnabled) { status.text = "Zapni Bluetooth."; return }
        val all = ad.bondedDevices.toList()
        val dive = all.filter { (it.name ?: "").matches(Regex("(?i).*(petrel|perdix|peregrine|teric|nerd|predator|tern).*")) }
        devices = dive.ifEmpty { all }
        devs.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, devices.map { "${it.name ?: "?"} (${it.address})" })
        if (devices.isEmpty()) status.text = "Žádný spárovaný počítač – spáruj Petrel v Nastavení → Bluetooth (PIN 0000)."
    }

    private fun add(s: String) = runOnUiThread { log.append("${SimpleDateFormat("HH:mm:ss", Locale.ROOT).format(Date())} $s\n") }
    private fun setStatus(s: String) = runOnUiThread { status.text = s }

    private fun cancel() { stop = true; setStatus("Ukončuji…"); try { socket?.close() } catch (_: Exception) {} }

    @SuppressLint("MissingPermission")
    private fun start() {
        val dev = devices.getOrNull(devs.selectedItemPosition) ?: return
        val limit = when (count.checkedRadioButtonId) { 100 -> 1; 101 -> 5; else -> Int.MAX_VALUE }
        stop = false; running = true; go.text = "Ukončit"; log.text = ""
        Thread {
            try {
                val res = run(dev, limit)
                if (res != null) runOnUiThread { share(res.first, res.second) }
            } catch (e: Exception) {
                add("Chyba: ${e.message}")
                setStatus(if (stop) "Ukončeno." else "Chyba: ${e.message}")
            } finally {
                try { socket?.close() } catch (_: Exception) {}
                running = false
                runOnUiThread { go.text = "Stáhnout" }
            }
        }.start()
    }

    /** Stáhne ponory a uloží je do souboru .myxbt; vrací (soubor, počet). */
    @SuppressLint("MissingPermission")
    private fun run(dev: BluetoothDevice, limit: Int): Pair<File, Int>? {
        setStatus("Připojuji ${dev.name}…")
        getSystemService(BluetoothManager::class.java)?.adapter?.cancelDiscovery()
        val s = try {
            dev.createRfcommSocketToServiceRecord(spp).also { it.connect() }
        } catch (e: Exception) {
            add("Připojení přes SPP selhalo (${e.message}) – zkouším kanál 5")
            // Petrel 2 má sériový port na kanálu RFCOMM 5
            (dev.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType).invoke(dev, 5) as BluetoothSocket).also { it.connect() }
        }
        socket = s
        add("Připojeno")
        val sw = Shearwater(s.inputStream, s.outputStream) { stop }
        sw.purge()
        setStatus("Čtu údaje počítače…")
        val serial = String(sw.rdbi(Shearwater.ID_SERIAL)).trim().uppercase()
        val fw = String(sw.rdbi(Shearwater.ID_FIRMWARE)).replace("\u0000", "").trim()
        val modelNo = try { sw.rdbi(Shearwater.ID_MODEL)[0].toInt() and 0xFF } catch (e: Exception) { add("Model: ${e.message}"); 0 }
        val model = Shearwater.MODELS[modelNo] ?: "Petrel"
        val lu = sw.rdbi(Shearwater.ID_LOGUPLOAD)
        val base = ((lu[1].toLong() and 0xFF) shl 24) or ((lu[2].toLong() and 0xFF) shl 16) or ((lu[3].toLong() and 0xFF) shl 8) or (lu[4].toLong() and 0xFF)
        add("S/N $serial, firmware $fw, model $modelNo ($model), log 0x${base.toString(16)}")
        if (base != 0x80000000L) throw Exception("Formát logu 0x${base.toString(16)} zatím neumím")
        setStatus("Čtu seznam ponorů…")
        val list = sw.manifest().sortedByDescending { it.fp }
        val todo = list.take(limit)
        add("V počítači ${list.size} ponorů, stahuji ${todo.size}")
        val arr = JSONArray()
        for ((k, e) in todo.withIndex()) {
            if (stop) break
            val t0 = System.currentTimeMillis()
            setStatus("Stahuji ponor ${k + 1}/${todo.size}…")
            val d = try {
                sw.download(base + e.addr, Shearwater.DIVE_SIZE, true) { b -> setStatus("Stahuji ponor ${k + 1}/${todo.size} · ${b / 1024} kB") }
            } catch (x: Exception) {
                // ukončení / přerušení: už stažené ponory se předají, rozpracovaný se zahodí
                add(if (stop) "Ukončeno uprostřed ponoru ${k + 1}" else "Přerušeno: ${x.message}")
                if (arr.length() == 0) throw x
                break
            }
            if (!Shearwater.complete(d)) { add("Ponor ${k + 1} se nestáhl celý – vynechán"); continue }
            var num = 0
            var i = 0
            while (i + 32 <= d.size) { if ((d[i].toInt() and 0xFF) == 0x10) { num = ((d[i + 2].toInt() and 0xFF) shl 8) or (d[i + 3].toInt() and 0xFF); break }; i += 32 }
            arr.put(JSONObject().put("fp", e.fp).put("num", num).put("data", Base64.encodeToString(d, Base64.NO_WRAP)))
            add("Ponor č. $num: ${d.size / 1024} kB za ${(System.currentTimeMillis() - t0) / 1000} s")
        }
        if (arr.length() == 0) { setStatus(if (stop) "Ukončeno – nic nestaženo." else "Nic nestaženo."); return null }
        val dir = File(cacheDir, "out").apply { mkdirs() }
        val f = File(dir, "petrel-$serial.myxbt")
        f.writeText(JSONObject().put("myxbt", 1).put("serial", serial).put("model", model).put("firmware", fw).put("dives", arr).toString())
        setStatus("Staženo ${arr.length()} ${if (arr.length() == 1) "ponor" else "ponorů"}${if (stop) " (ukončeno)" else ""} – vyber myX")
        return f to arr.length()
    }

    private fun share(f: File, n: Int) {
        val uri = FileProvider.getUriForFile(this, "cz.myx.petrel.files", f)
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "application/octet-stream"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(i, "Poslat $n ${if (n == 1) "ponor" else "ponorů"} do myX"))
    }
}
