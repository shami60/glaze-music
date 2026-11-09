// smtc.cpp — Windows System Media Transport Controls bridge for Glaze Music.
//
// Electron ships no SMTC integration: `navigator.mediaSession` is a Blink API and the
// last hop into Windows lives in Chrome's browser layer, which Electron does not
// include. This DLL is that hop.
//
// It is a plain C-ABI DLL rather than a Node addon on purpose: it is loaded through
// koffi (FFI), so it never has to be rebuilt when Electron's Node ABI changes. That
// matters for an app that updates itself.
//
// Button events are *polled* (`smtc_take_button`) instead of called back into JS.
// The SMTC handler runs on a WinRT thread, and invoking into V8 from there is not
// safe; a 250 ms poll in the main process costs nothing and cannot crash.

#include <windows.h>
#include <unknwn.h>
#include <inspectable.h>
#include <systemmediatransportcontrolsinterop.h>

#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>

#include <atomic>
#include <string>

using namespace winrt;
using namespace Windows::Media;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;

namespace {

SystemMediaTransportControls g_smtc{ nullptr };
std::atomic<int> g_button{ -1 };
std::wstring g_thumb;

// Windows.Media.SystemMediaTransportControlsButton, returned to JS as-is.
// Play 0, Pause 1, Stop 2, Record 3, FastForward 4, Rewind 5, Next 6, Previous 7,
// ChannelUp 8, ChannelDown 9.

std::wstring Utf8ToWide(const char* s) {
  if (!s || !*s) return {};
  int n = ::MultiByteToWideChar(CP_UTF8, 0, s, -1, nullptr, 0);
  if (n <= 1) return {};
  std::wstring out(static_cast<size_t>(n - 1), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, s, -1, out.data(), n);
  return out;
}

winrt::Windows::Foundation::TimeSpan Seconds(double s) {
  if (!(s > 0)) s = 0;
  return winrt::Windows::Foundation::TimeSpan{ static_cast<int64_t>(s * 10000000.0) };
}

}  // namespace

extern "C" {

// Attach to the window's media session. `hwnd` arrives as a plain integer so koffi
// can pass it without pointer gymnastics.
__declspec(dllexport) int smtc_init(int64_t hwnd) {
  try {
    if (g_smtc) return 0;
    if (!hwnd) return 1;

    auto interop = get_activation_factory<SystemMediaTransportControls,
                                          ISystemMediaTransportControlsInterop>();
    check_hresult(interop->GetForWindow(
        reinterpret_cast<HWND>(static_cast<intptr_t>(hwnd)),
        guid_of<SystemMediaTransportControls>(), put_abi(g_smtc)));

    g_smtc.IsEnabled(true);
    g_smtc.IsPlayEnabled(true);
    g_smtc.IsPauseEnabled(true);
    g_smtc.IsStopEnabled(true);
    g_smtc.IsNextEnabled(true);
    g_smtc.IsPreviousEnabled(true);

    g_smtc.ButtonPressed([](SystemMediaTransportControls const&,
                            SystemMediaTransportControlsButtonPressedEventArgs const& args) {
      g_button.store(static_cast<int>(args.Button()));
    });
    return 0;
  } catch (...) {
    g_smtc = nullptr;
    return 2;
  }
}

__declspec(dllexport) int smtc_update(const char* title, const char* artist,
                                      const char* album, const char* thumbPath,
                                      int playing, double position, double duration) {
  try {
    if (!g_smtc) return 1;

    auto updater = g_smtc.DisplayUpdater();
    updater.Type(MediaPlaybackType::Music);
    auto music = updater.MusicProperties();
    music.Title(Utf8ToWide(title));
    music.Artist(Utf8ToWide(artist));
    music.AlbumTitle(Utf8ToWide(album));

    // Artwork is a file on disk; loading it is a WinRT async call, so only do it when
    // the path actually changes.
    std::wstring want = Utf8ToWide(thumbPath);
    if (!want.empty() && want != g_thumb) {
      try {
        auto file = StorageFile::GetFileFromPathAsync(want).get();
        updater.Thumbnail(RandomAccessStreamReference::CreateFromFile(file));
        g_thumb = want;
      } catch (...) {
        // A missing or unreadable cover must not cost us the whole update.
      }
    }
    updater.Update();

    g_smtc.PlaybackStatus(playing ? MediaPlaybackStatus::Playing
                                  : MediaPlaybackStatus::Paused);

    if (duration > 0) {
      SystemMediaTransportControlsTimelineProperties tl;
      tl.StartTime(Seconds(0));
      tl.EndTime(Seconds(duration));
      tl.Position(Seconds(position));
      tl.MinSeekTime(Seconds(0));
      tl.MaxSeekTime(Seconds(duration));
      g_smtc.UpdateTimelineProperties(tl);
    }
    return 0;
  } catch (...) {
    return 2;
  }
}

// -1 when nothing was pressed since the last call.
__declspec(dllexport) int smtc_take_button() {
  return g_button.exchange(-1);
}

__declspec(dllexport) void smtc_shutdown() {
  try {
    if (g_smtc) {
      g_smtc.IsEnabled(false);
      g_smtc = nullptr;
    }
  } catch (...) {
  }
  g_thumb.clear();
  g_button.store(-1);
}

}  // extern "C"

BOOL APIENTRY DllMain(HMODULE, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    // WinRT needs an MTA on the calling thread; Node's main thread has no apartment.
    try {
      winrt::init_apartment(winrt::apartment_type::multi_threaded);
    } catch (...) {
    }
  }
  return TRUE;
}
