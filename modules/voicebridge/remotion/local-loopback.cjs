// Restricted hosts may not expose interface enumeration. Keep local preview usable.
const os=require('node:os');const original=os.networkInterfaces;
os.networkInterfaces=function(){try{return original();}catch{return {lo:[{address:'127.0.0.1',family:'IPv4',internal:true,netmask:'255.0.0.0',cidr:'127.0.0.1/8',mac:'00:00:00:00:00:00'}]};}};
