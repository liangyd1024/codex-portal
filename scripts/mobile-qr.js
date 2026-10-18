// macOS system frameworks keep setup independent of Python packages.
ObjC.import('Cocoa');
ObjC.import('CoreImage');
function run(args) {
 const filter=$.CIFilter.filterWithName('CIQRCodeGenerator');
 filter.setValueForKey($(args[0]).dataUsingEncoding($.NSUTF8StringEncoding),'inputMessage');
 filter.setValueForKey($('M'),'inputCorrectionLevel');
 const rep=$.NSCIImageRep.imageRepWithCIImage(filter.outputImage);
 const image=$.NSImage.alloc.initWithSize(rep.size);
 image.addRepresentation(rep);
 const bitmap=$.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
 const png=bitmap.representationUsingTypeProperties($.NSPNGFileType,$({}));
 if(!png.writeToFileAtomically($(args[1]),true))throw Error('二维码保存失败');
}
