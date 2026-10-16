"""Size retained matched charts for browser planning, without rendering guesses."""
import collections,json,math,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
doc=json.loads((ROOT/'exports/lighting/static-atlas-instance-matches.json').read_text(encoding='utf-8'))
width,height=5232,4908
unique={};zero=[];outside=[];assets=collections.Counter()
for row in doc['matched']:
    a,b,c,d,u,v,z,w=row['values']
    assert b==c==z==w==0
    if a==0 or d==0:zero.append(row['instanceIndex']);continue
    assert a>0 and d>0
    # Conservative normalized UV domain0..1, including bilinear neighbors.
    left=math.floor(u*width-.5);top=math.floor(v*height-.5)
    right=math.ceil((u+a)*width-.5);bottom=math.ceil((v+d)*height-.5)
    bounds=[left,top,right,bottom]
    if left<0 or top<0 or right>=width or bottom>=height:outside.append({'instanceIndex':row['instanceIndex'],'bounds':bounds})
    key=tuple(row['values'])
    record=unique.setdefault(key,{'values':row['values'],'bounds':bounds,'width':right-left+1,'height':bottom-top+1,'instances':[]})
    record['instances'].append(row['instanceIndex']);assets[row['assetId']]+=1
charts=list(unique.values());pixels=sum(c['width']*c['height'] for c in charts)
report={'evidenceId':'BF2-NATIVE-STATIC-ATLAS-COVERAGE-001','sourceEvidence':doc['evidenceId'],'sourceDimensions':[width,height],
    'matchedInstances':doc['matchedCount'],'zeroScaleInstances':zero,'nonzeroChartInstances':sum(assets.values()),'uniqueTransforms':len(charts),
    'conservativeCropPixels':pixels,'sourceAtlasPixels':width*height,'fourRgba32fLayersBytes':pixels*4*16,
    'maximumCropDimensions':[max(c['width'] for c in charts),max(c['height'] for c in charts)],'outOfAtlasBounds':outside,
    'assets':[{'assetId':k,'instances':v} for k,v in assets.most_common()],'charts':charts,
    'limitations':['Planning only. Normalized chart domain0..1 and full bilinear-neighbor padding are conservative; actual native mesh UV ranges remain separate.',
    'No texture repacking, sampler mode, shader substitution or runtime activation follows from this count.',
    'Repeated transform records are deduplicated; overlapping distinct rectangles are still counted separately.']}
(ROOT/'exports/lighting/static-atlas-coverage.json').write_text(json.dumps(report,separators=(',',':')),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k not in ['charts','assets','zeroScaleInstances','outOfAtlasBounds']},indent=2))
print(json.dumps({'zeroScaleCount':len(zero),'outsideCount':len(outside)}))
