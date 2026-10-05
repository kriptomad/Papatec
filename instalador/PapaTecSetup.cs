// ============================================================================
//  PapaTec - Setup (stub do instalador)
// ----------------------------------------------------------------------------
//  Compilado com csc.exe (nativo do Windows, sem .NET SDK) e empacotado com
//  um ZIP APPENDIDO no fim do proprio .exe. Um unico arquivo = instalador.
//
//  Como o payload e localizado:
//     [ stub.exe ] [ ZIP do projeto ] [ magic "PAPAtec" | int64 tamanhoZip ]
//  O stub le os ultimos 16 bytes, valida o magic e volta o tamanho do ZIP.
//  Nao hamagic nem tamanho fixos no PE, entao nada colide com o executavel.
//
//  Compativel com C# 5 (csc.exe do .NET Framework 4.x): sem interpolacao de
//  string, sem ?. e sem nameof.
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class PapaTecSetup
{
    // Magic + tamanho do payload, gravados pelo GERAR-INSTALADOR.ps1.
    // A magic PRECISA ter 8 bytes: o trailer tem tamanho fixo (8 + int64).
    private const string Magic = "PAPA_SET";
    private const int TrailerSize = 16;

    private const string DefaultInstallDir = @"C:\Program Files\PapaTec";
    private const string PsExe = "powershell.exe";
    private const string DockerInstallerUrl =
        "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe";

    // Nunca extrair isto: e da maquina de destino, nao do instalador
    private static readonly string[] NeverExtract = { ".env" };

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Title("PapaTec - Instalador");

        try
        {
            if (!IsAdmin())
            {
                return Falhar("Este instalador precisa de administrador. " +
                              "Clique com o botao direito e escolha 'Executar como administrador'.");
            }

            string dir = InstallDir(args);
            string mode = Mode(args);

            if (mode == "extrair")
            {
                Extract(dir);
                return 0;
            }

            if (!EnsureExtracted(dir))
                return Falhar("Nao consegui preparar os arquivos em " + dir);

            if (mode == "menu") { Menu(dir); return 0; }

            return Run(dir, mode, args);
        }
        catch (Exception ex)
        {
            return Falhar(ex.Message);
        }
    }

    // ----------------------------------------------------------------- util

    private static void Title(string t)
    {
        try { Console.Title = t; } catch { }
        Say("============================================================", ConsoleColor.DarkCyan);
        Say("   " + t, ConsoleColor.Cyan);
        Say("============================================================", ConsoleColor.DarkCyan);
    }

    private static void Say(string m) { Say(m, ConsoleColor.Gray); }

    private static void Say(string m, ConsoleColor c)
    {
        Console.ForegroundColor = c;
        Console.WriteLine(m);
        Console.ResetColor();
    }
    private static void Ok(string m) { Say("   [OK] " + m, ConsoleColor.Green); }
    private static void Warn(string m) { Say("   [!] " + m, ConsoleColor.Yellow); }
    private static void Head(string m) { Say(""); Say(">> " + m, ConsoleColor.Cyan); }
    private static int Falhar(string m)
    {
        Say("   [ERRO] " + m, ConsoleColor.Red);
        Say("");
        Say("   Veja o diagnostico:  INSTALAR.bat verificar", ConsoleColor.DarkGray);
        Pausar();
        return 1;
    }

    /// Espera uma tecla antes de fechar. Console.ReadKey LANCA excecao se a
    /// entrada foi redirecionada (execucao via .bat, CI, Start-Process com
    /// redirecionamento) - e a excecao nao tratada virava um crash com
    /// codigo 0xE0434352 em vez da mensagem de erro.
    private static void Pausar()
    {
        try { Console.ReadKey(true); return; }
        catch { }
        try { Console.ReadLine(); } catch { }
    }

    private static bool IsAdmin()
    {
        // Compile-time: existe SO no stub de teste. O .exe entregue nunca
        // tem esta Definicao, entao nao da para burlar por ambiente.
#if TESTADMIN
        return true;
#else
        try
        {
            var id = System.Security.Principal.WindowsIdentity.GetCurrent();
            var p = new System.Security.Principal.WindowsPrincipal(id);
            return p.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
#endif
    }

    private static string ArgOf(string[] a, string name, string def)
    {
        for (int i = 0; i < a.Length; i++)
        {
            if (a[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return i + 1 < a.Length ? a[i + 1] : "";
            if (a[i].StartsWith(name + "=", StringComparison.OrdinalIgnoreCase))
                return a[i].Substring(name.Length + 1);
        }
        return def;
    }
    private static bool HasFlag(string[] a, string name)
    {
        for (int i = 0; i < a.Length; i++)
            if (a[i].Equals(name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private static string InstallDir(string[] a)
    {
        string d = ArgOf(a, "/D", ArgOf(a, "/DIR", ""));
        if (d.Length == 0)
        {
            string env = Environment.GetEnvironmentVariable("PAPATEC_DIR");
            d = (env != null && env.Length > 0) ? env : DefaultInstallDir;
        }
        return d.TrimEnd('\\');
    }

    /// Modo: extrair | menu | preparar | producao | teste | verificar | iniciar | parar | logs | licenca | backup
    private static string Mode(string[] a)
    {
        string m = ArgOf(a, "/M", "");
        if (m.Length > 0) return m.ToLowerInvariant();

        var modos = new List<string>();
        for (int i = 0; i < a.Length; i++)
        {
            string s = a[i].TrimStart('/').ToLowerInvariant();
            if (s == "producao" || s == "produção" || s == "install" || s == "instalar") modos.Add("producao");
            else if (s == "teste" || s == "dev") modos.Add("teste");
            else if (s == "preparar") modos.Add("preparar");
            else if (s == "verificar" || s == "check" || s == "diagnostico") modos.Add("verificar");
            else if (s == "menu") modos.Add("menu");
            else if (s == "extrair") modos.Add("extrair");
            else if (s == "iniciar" || s == "start") modos.Add("iniciar");
            else if (s == "parar" || s == "stop") modos.Add("parar");
            else if (s == "logs") modos.Add("logs");
            else if (s == "licenca") modos.Add("licenca");
            else if (s == "backup") modos.Add("backup");
        }
        return modos.Count > 0 ? modos[0] : "menu";
    }

    // ------------------------------------------------- payload (ZIP no fim)

    private static string SelfPath()
    {
        return new Uri(Assembly.GetExecutingAssembly().CodeBase).LocalPath;
    }

    /// Localiza o ZIP appended e devolve {offset, tamanho}, ou null.
    private static long[] FindPayload()
    {
        string self = SelfPath();
        FileInfo fi = new FileInfo(self);
        if (fi.Length <= TrailerSize) return null;

        using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            fs.Seek(-TrailerSize, SeekOrigin.End);
            byte[] tr = new byte[TrailerSize];
            if (fs.Read(tr, 0, TrailerSize) != TrailerSize) return null;

            string magic = Encoding.ASCII.GetString(tr, 0, 8);
            if (magic != Magic) return null;

            long len = BitConverter.ToInt64(tr, 8);
            if (len <= 0 || len > fi.Length - TrailerSize) return null;

            return new long[] { fi.Length - TrailerSize - len, len };
        }
    }

    private static bool EnsureExtracted(string dir)
    {
        Head("ARQUIVOS DO SISTEMA");

        long[] loc = FindPayload();
        if (loc == null)
        {
            // Sem payload embutido: esta rodando a partir da pasta do projeto.
            if (File.Exists(Path.Combine(dir, "INSTALAR.ps1")))
            {
                Warn("sem payload embutido - usando os arquivos desta pasta");
                return true;
            }
            return false;
        }

        string stamp = Path.Combine(dir, ".payload-ok");
        // Reconta extrair toda vez que o tamanho do payload mudar, ou se o
        // INSTALAR.ps1 nao estiver la (pasta apagada / instalacao quebrada).
        if (File.Exists(stamp) && File.Exists(Path.Combine(dir, "INSTALAR.ps1"))) return true;

        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        Ok("destino: " + dir);

        int extraidos = 0, substituidos = 0;
        using (FileStream fs = new FileStream(SelfPath(), FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            fs.Seek(loc[0], SeekOrigin.Begin);
            // ZipArchive precisa de um Stream nao seekavel: embrulha em buffer
            // apenas o ZIP (o projeto tem poucos MB).
            byte[] buf = new byte[loc[1]];
            int lidos = ReadFull(fs, buf);
            using (var ms = new MemoryStream(buf, 0, lidos, false))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                foreach (var e in zip.Entries)
                {
                    string rel = e.FullName.Replace('/', '\\');
                    if (rel.EndsWith("/") || rel.Length == 0) continue;
                    if (IsExcluded(rel)) continue;

                    string dest = Path.Combine(dir, rel);
                    string destDir = Path.GetDirectoryName(dest);
                    if (destDir != null && !Directory.Exists(destDir)) Directory.CreateDirectory(destDir);

                    if (File.Exists(dest))
                    {
                        // .env e onde a maquina guarda seus segredos: nunca toca.
                        if (IsNeverExtract(rel)) continue;
                        substituidos++;
                    }
                    else extraidos++;

                    try
                    {
                        if (File.Exists(dest)) File.Delete(dest);
                        e.ExtractToFile(dest, true);
                    }
                    catch (Exception ex)
                    {
                        Warn("nao consegui extrair " + rel + ": " + ex.Message);
                    }
                }
            }
        }

        Ok(string.Format("extraidos: {0}   atualizados: {1}", extraidos, substituidos));
        File.WriteAllText(stamp, DateTime.Now.ToString("s"));
        return File.Exists(Path.Combine(dir, "INSTALAR.ps1"));
    }

    private static int ReadFull(Stream s, byte[] buf)
    {
        int total = 0;
        while (total < buf.Length)
        {
            int r = s.Read(buf, total, buf.Length - total);
            if (r <= 0) break;
            total += r;
        }
        return total;
    }

    private static bool IsNeverExtract(string rel)
    {
        string nome = Path.GetFileName(rel);
        for (int i = 0; i < NeverExtract.Length; i++)
            if (nome.Equals(NeverExtract[i], StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    /// Ignora lixo de desenvolvimento que nao deve viajar no instalador.
    private static bool IsExcluded(string rel)
    {
        string[] junkDirs = { "node_modules", "\\.git\\", "\\dist\\", "\\build\\", "\\.vite\\", "\\coverage\\" };
        for (int i = 0; i < junkDirs.Length; i++)
            if (rel.IndexOf(junkDirs[i], StringComparison.OrdinalIgnoreCase) >= 0) return true;

        string[] junkFiles = {
            ".env", ".DS_Store", "Thumbs.db", "build.log",
            "*.log", "*.tmp", "*.bak", "*.zip", "*.exe"
        };
        string nome = Path.GetFileName(rel);
        for (int i = 0; i < junkFiles.Length; i++)
        {
            string f = junkFiles[i];
            if (f.StartsWith("*")) { if (nome.EndsWith(f.Substring(1), StringComparison.OrdinalIgnoreCase)) return true; }
            else if (nome.Equals(f, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static int Extract(string dir)
    {
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        return EnsureExtracted(dir) ? 0 : Falhar("falha ao extrair o payload");
    }

    // ------------------------------------------------------------ execucao

    private static int Run(string dir, string mode, string[] args)
    {
        string ps = Path.Combine(dir, "INSTALAR.ps1");
        if (!File.Exists(ps))
            return Falhar("INSTALAR.ps1 nao encontrado em " + dir);

        var p = new List<string>();
        p.Add("-NoProfile");
        p.Add("-ExecutionPolicy"); p.Add("Bypass");
        p.Add("-File"); p.Add("\"" + ps + "\"");
        p.Add(mode);

        // repassa flags uteis (ex.: /license-token=...)
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i].StartsWith("/license-token", StringComparison.OrdinalIgnoreCase))
                p.Add(args[i]);

        Head("INSTALACAO (" + mode + ")");
        Say("   " + String.Join(" ", p.ToArray()), ConsoleColor.DarkGray);
        Say("");

        try
        {
            var psi = new ProcessStartInfo(PsExe, String.Join(" ", p.ToArray()));
            psi.UseShellExecute = false;
            psi.WorkingDirectory = dir;
            var proc = Process.Start(psi);
            proc.WaitForExit();

            Say("");
            if (proc.ExitCode == 0) { Ok("instalador terminou com sucesso"); }
            else { Warn("o instalador terminou com codigo " + proc.ExitCode); }
            return proc.ExitCode;
        }
        catch (Exception ex)
        {
            return Falhar("nao consegui executar o instalador: " + ex.Message);
        }
    }

    private static void Menu(string dir)
    {
        Console.Clear();
        Title("PapaTec - Instalador");
        Say("   Pasta de instalacao : " + dir);
        Say("   Modo                : " + (TentaModo(dir) ? "PRODUCAO" : "nenhum sistema rodando"));
        Say("");
        Say("   [1] Instalar (PRODUCAO)  <-- recomendado para o cliente", ConsoleColor.White);
        Say("   [2] So preparar a maquina (Docker + .env, sem build)", ConsoleColor.White);
        Say("   [3] Verificar / diagnosticar", ConsoleColor.Gray);
        Say("   [4] Modo TESTE (desenvolvimento, hot reload)", ConsoleColor.White);
        Say("   [5] Onde o Docker esta sendo baixado?", ConsoleColor.DarkGray);
        Say("   [6] Sair", ConsoleColor.Gray);
        Say("");

        string op = Ler("Opcao");
        if (op == "1") Run(dir, "producao", new string[0]);
        else if (op == "2") Run(dir, "preparar", new string[0]);
        else if (op == "3") Run(dir, "verificar", new string[0]);
        else if (op == "4") Run(dir, "teste", new string[0]);
        else if (op == "5") InfoDocker();
        else Say("   ate!", ConsoleColor.DarkGray);
    }

    private static string Ler(string rotulo)
    {
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("   " + rotulo + ": ");
        Console.ResetColor();
        // ReadLine devolve null com a entrada redirecionada. Sem este
        // tratamento o menu quebra com NullReferenceException.
        string s = Console.ReadLine();
        return s == null ? "" : s.Trim();
    }

    /// Sem Docker, o instalador baixa o Docker Desktop da URL oficial. O
    /// cliente pode deixar o instalador oficial ao lado deste .exe para
    /// instalar SEM internet.
    private static void InfoDocker()
    {
        Head("DOCKER DESKTOP");
        Say("   Se o Docker Desktop nao estiver instalado, o PapaTec baixa da", ConsoleColor.White);
        Say("   URL oficial do proprio Docker:", ConsoleColor.White);
        Say("     " + DockerInstallerUrl, ConsoleColor.Cyan);
        Say("");
        Say("   SEM INTERNET? Deixe o instalador oficial ao lado deste .exe:", ConsoleColor.Yellow);
        Say("     PapaTec-Setup.exe", ConsoleColor.DarkGray);
        Say("     DockerDesktopInstaller.exe", ConsoleColor.DarkGray);
        Say("   e o passo 'Preparar a maquina' usa o arquivo local.", ConsoleColor.Yellow);
        Say("");
        Say("   Obs.: o Docker Desktop exige UMA reinicializacao do Windows", ConsoleColor.DarkGray);
        Say("   antes de a primeira subida.", ConsoleColor.DarkGray);
    }

    private static bool TentaModo(string dir)
    {
        try
        {
            var psi = new ProcessStartInfo("docker", "ps --filter name=papatec-web --format {{.Names}}");
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            var pr = Process.Start(psi);
            string outp = pr.StandardOutput.ReadToEnd();
            pr.WaitForExit(5000);
            return outp.Trim().Length > 0;
        }
        catch { return false; }
    }
}