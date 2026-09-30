#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <cstdio>
#include <cwchar>
#include <string>
int main(int argc,char**argv){
 const std::string action=argc>1?argv[1]:"status";
 if(action!="mute"&&action!="unmute"&&action!="status")return 2;
 HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);if(FAILED(hr))return 3;
 IMMDeviceEnumerator* en=nullptr;IMMDeviceCollection* devices=nullptr;int found=0,muted=0,errors=0;
 hr=CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),(void**)&en);
 if(SUCCEEDED(hr))hr=en->EnumAudioEndpoints(eRender,DEVICE_STATE_ACTIVE,&devices);
 if(FAILED(hr)){if(en)en->Release();CoUninitialize();return 4;}
 UINT n=0;devices->GetCount(&n);
 for(UINT d=0;d<n;d++){
 IMMDevice* device=nullptr;IAudioSessionManager2* manager=nullptr;IAudioSessionEnumerator* sessions=nullptr;
 if(SUCCEEDED(devices->Item(d,&device))&&SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,(void**)&manager))&&SUCCEEDED(manager->GetSessionEnumerator(&sessions))){
 int count=0;sessions->GetCount(&count);
 for(int i=0;i<count;i++){
 IAudioSessionControl* control=nullptr;IAudioSessionControl2* control2=nullptr;ISimpleAudioVolume* volume=nullptr;
 if(SUCCEEDED(sessions->GetSession(i,&control))&&SUCCEEDED(control->QueryInterface(__uuidof(IAudioSessionControl2),(void**)&control2))){
 DWORD pid=0;control2->GetProcessId(&pid);HANDLE process=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,pid);wchar_t path[32768];DWORD len=32768;
 bool target=false;if(process){if(QueryFullProcessImageNameW(process,0,path,&len)){const wchar_t* name=wcsrchr(path,L'\\');name=name?name+1:path;target=_wcsicmp(name,L"ts3client_win64.exe")==0||_wcsicmp(name,L"ts3client_win32.exe")==0;}CloseHandle(process);}
 if(target){found++;if(SUCCEEDED(control->QueryInterface(__uuidof(ISimpleAudioVolume),(void**)&volume))){
 if(action!="status"&&FAILED(volume->SetMute(action=="mute",nullptr)))errors++;
 BOOL state=FALSE;if(FAILED(volume->GetMute(&state)))errors++;else if(state)muted++;
 }else errors++;}
 }
 if(volume)volume->Release();if(control2)control2->Release();if(control)control->Release();
 }
 }
 if(sessions)sessions->Release();if(manager)manager->Release();if(device)device->Release();
 }
 devices->Release();en->Release();CoUninitialize();
 printf("{\"sessions\":%d,\"muted\":%d,\"errors\":%d}\n",found,muted,errors);return 0;
}
